import os
import io
from flask import Flask, request, send_file, send_from_directory, jsonify
from PIL import Image
import fitz  # PyMuPDF
from werkzeug.utils import secure_filename
import tempfile

app = Flask(__name__, static_folder='.', static_url_path='')

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

def compress_image(file_obj, target_mb, max_width, max_height, explicit_quality=80):
    img = Image.open(file_obj)
    
    # Resize if dimensions are provided
    if max_width or max_height:
        original_width, original_height = img.size
        ratio = min(max_width / original_width if max_width else 1.0, 
                    max_height / original_height if max_height else 1.0)
        if ratio < 1.0:
            new_width = int(original_width * ratio)
            new_height = int(original_height * ratio)
            img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
    
    format_to_save = 'JPEG'
    if img.mode in ('RGBA', 'P'):
        img = img.convert('RGB')
    
    def save_with_quality(img_obj, q):
        out = io.BytesIO()
        img_obj.save(out, format=format_to_save, quality=q, optimize=True)
        out.seek(0)
        return out

    # If target_mb is provided, use binary search. Otherwise, use explicit quality.
    if target_mb:
        target_bytes = target_mb * 1024 * 1024
        
        # Keep quality decent, minimum 30 to avoid excessive blurring
        # If still too large at quality 30, scale down dimensions
        scale = 1.0
        current_img = img
        best_output = None
        
        for step in range(15):
            low = 30
            high = 95
            found_in_this_scale = False
            
            while low <= high:
                mid = (low + high) // 2
                temp_output = save_with_quality(current_img, mid)
                size = temp_output.getbuffer().nbytes
                
                if size <= target_bytes:
                    best_output = temp_output
                    found_in_this_scale = True
                    # Try to get better quality that still fits
                    low = mid + 1
                else:
                    high = mid - 1
            
            if found_in_this_scale:
                break
                
            # If we couldn't find any quality >= 30 that fits, scale down
            scale *= 0.8
            new_w = max(int(img.width * scale), 10)
            new_h = max(int(img.height * scale), 10)
            current_img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)
            
            if new_w == 10 and new_h == 10:
                break
                
        if best_output:
            return best_output, 'image/jpeg', 'compressed.jpg'
            
        # If it still doesn't fit, just return the smallest we got
        return save_with_quality(current_img, 10), 'image/jpeg', 'compressed.jpg'
    
    # If no target size, use the provided quality value
    return save_with_quality(img, explicit_quality), 'image/jpeg', 'compressed.jpg'

def compress_pdf(file_obj, target_mb=None, explicit_quality=40):
    pdf_bytes = file_obj.read()
    doc = fitz.open("pdf", pdf_bytes)
    
    # Cache all unique images first to avoid extracting them multiple times
    images_info = {}
    for page_num in range(len(doc)):
        page = doc[page_num]
        for img in page.get_images(full=True):
            xref = img[0]
            if xref in images_info:
                continue
            try:
                base_image = doc.extract_image(xref)
                image_bytes = base_image["image"]
                pil_img = Image.open(io.BytesIO(image_bytes))
                if pil_img.mode in ('RGBA', 'P'):
                    pil_img = pil_img.convert('RGB')
                images_info[xref] = (page_num, pil_img)
            except Exception:
                pass
    doc.close()

    # If the PDF has no images, image compression won't reduce its size.
    # Just deflate the structure once and return it.
    if not images_info:
        output = io.BytesIO()
        temp_doc = fitz.open("pdf", pdf_bytes)
        temp_doc.save(output, garbage=4, deflate=True, clean=True)
        temp_doc.close()
        output.seek(0)
        return output, 'application/pdf', 'compressed.pdf'

    if target_mb:
        target_bytes = target_mb * 1024 * 1024
        scale = 1.0
        best_output = None
        
        # Max 4 scale reductions to prevent timeouts on large files
        for step in range(4):
            # Pre-scale images for this specific scale step (resizing is CPU intensive)
            scaled_images = {}
            for xref, (page_num, pil_img) in images_info.items():
                if scale < 1.0:
                    new_w = max(int(pil_img.width * scale), 10)
                    new_h = max(int(pil_img.height * scale), 10)
                    scaled_images[xref] = (page_num, pil_img.resize((new_w, new_h), Image.Resampling.LANCZOS))
                else:
                    scaled_images[xref] = (page_num, pil_img)

            def try_compress_cached(quality):
                temp_doc = fitz.open("pdf", pdf_bytes)
                for x_ref, (p_num, s_img) in scaled_images.items():
                    try:
                        img_io = io.BytesIO()
                        s_img.save(img_io, format="JPEG", quality=quality, optimize=True)
                        temp_doc[p_num].replace_image(x_ref, stream=img_io.getvalue())
                    except Exception:
                        pass
                
                output = io.BytesIO()
                temp_doc.save(output, garbage=4, deflate=True, clean=True)
                temp_doc.close()
                output.seek(0)
                return output

            low = 20
            high = 90
            found_in_this_scale = False
            
            # Max 5 binary search steps
            for _ in range(5):
                if low > high:
                    break
                mid = (low + high) // 2
                temp_output = try_compress_cached(quality=mid)
                size = temp_output.getbuffer().nbytes
                
                if size <= target_bytes:
                    best_output = temp_output
                    found_in_this_scale = True
                    low = mid + 1  # Try higher quality
                else:
                    high = mid - 1 # Try lower quality
                    
            if found_in_this_scale:
                break
                
            scale *= 0.7  # More aggressive scale down to hit targets faster
            
        if best_output:
            return best_output, 'application/pdf', 'compressed.pdf'
            
        # Fallback if still over target
        return try_compress_cached(10), 'application/pdf', 'compressed.pdf'
        
    else:
        # Default single-pass compression
        def compress_once():
            temp_doc = fitz.open("pdf", pdf_bytes)
            for xref, (p_num, pil_img) in images_info.items():
                try:
                    img_io = io.BytesIO()
                    pil_img.save(img_io, format="JPEG", quality=explicit_quality, optimize=True)
                    temp_doc[p_num].replace_image(xref, stream=img_io.getvalue())
                except Exception:
                    pass
            output = io.BytesIO()
            temp_doc.save(output, garbage=4, deflate=True, clean=True)
            temp_doc.close()
            output.seek(0)
            return output
            
        return compress_once(), 'application/pdf', 'compressed.pdf'

@app.route('/compress', methods=['POST'])
def compress_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
        
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
        
    target_mb = request.form.get('targetSizeMB', type=float)
    max_width = request.form.get('targetWidth', type=int)
    max_height = request.form.get('targetHeight', type=int)
    quality = request.form.get('quality', default=80, type=int)
    
    filename = secure_filename(file.filename)
    ext = filename.rsplit('.', 1)[-1].lower()
    
    try:
        if ext in ['jpg', 'jpeg', 'png']:
            output, mimetype, out_filename = compress_image(file, target_mb, max_width, max_height, quality)
        elif ext == 'pdf':
            output, mimetype, out_filename = compress_pdf(file, target_mb, quality)
        else:
            return jsonify({'error': 'Unsupported file format'}), 400
            
        return send_file(
            output,
            mimetype=mimetype,
            as_attachment=True,
            download_name=out_filename
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)
