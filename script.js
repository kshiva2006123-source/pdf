document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    // Sections
    const uploadSection = document.getElementById('upload-section');
    const settingsSection = document.getElementById('settings-section');
    const processSection = document.getElementById('process-section');
    const resultSection = document.getElementById('result-section');

    // Stepper
    const steps = [
        document.getElementById('step-1'),
        document.getElementById('step-2'),
        document.getElementById('step-3'),
        document.getElementById('step-4')
    ];
    const stepLines = document.querySelectorAll('.step-line');

    // Upload Elements
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const browseBtn = document.getElementById('browse-btn');
    const uploadFilePreview = document.getElementById('upload-file-preview');
    const uploadFilename = document.getElementById('upload-filename');
    const uploadFilesize = document.getElementById('upload-filesize');
    const uploadFileBadge = document.getElementById('upload-file-badge');
    const removeFileBtn = document.getElementById('remove-file-btn');
    const goConfigureBtn = document.getElementById('go-configure-btn');

    // Settings Elements
    const originalFilename = document.getElementById('original-filename');
    const originalFilesize = document.getElementById('original-filesize');
    const settingsFileBadge = document.getElementById('settings-file-badge');
    const targetSizeInput = document.getElementById('target-size');
    const targetWidthInput = document.getElementById('target-width');
    const targetHeightInput = document.getElementById('target-height');
    const compressBtn = document.getElementById('compress-btn');
    const dimensionsGroup = document.getElementById('dimensions-group');
    const qualityGroup = document.getElementById('quality-group');
    const qualitySlider = document.getElementById('image-quality');
    const qualityVal = document.getElementById('quality-val');

    qualitySlider.addEventListener('input', (e) => {
        qualityVal.textContent = e.target.value;
    });

    // Result Elements
    const resultOriginalSize = document.getElementById('result-original-size');
    const resultNewSize = document.getElementById('result-new-size');
    const resultSavedPercent = document.getElementById('result-saved-percent');
    const viewBtn = document.getElementById('view-btn');
    const downloadBtn = document.getElementById('download-btn');
    const startOverBtn = document.getElementById('start-over-btn');

    // State
    let currentFile = null;
    let compressedFileBlob = null;
    let originalSize = 0;
    let objectUrl = null;

    // --- Helpers ---
    const formatBytes = (bytes, decimals = 1) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    };

    const getFileExt = (filename) => {
        return filename.split('.').pop().toUpperCase();
    };

    const updateStepper = (activeStepIndex) => {
        steps.forEach((step, index) => {
            step.classList.remove('active', 'completed');
            if (index < activeStepIndex) {
                step.classList.add('completed');
            } else if (index === activeStepIndex) {
                step.classList.add('active');
            }
        });

        stepLines.forEach((line, index) => {
            if (index < activeStepIndex) {
                line.classList.add('active');
            } else {
                line.classList.remove('active');
            }
        });
    };

    const showSection = (sectionToShow, stepIndex) => {
        [uploadSection, settingsSection, processSection, resultSection].forEach(sec => {
            if (sec) {
                sec.classList.remove('active-section');
                sec.classList.add('hidden-section');
            }
        });
        sectionToShow.classList.remove('hidden-section');
        sectionToShow.classList.add('active-section');
        updateStepper(stepIndex);
    };

    // --- Upload Handlers ---
    const handleFile = (file) => {
        if (!file) return;

        const validTypes = ['image/jpeg', 'image/png', 'application/pdf'];
        if (!validTypes.includes(file.type)) {
            alert('Please upload a valid JPG, PNG, or PDF file.');
            return;
        }

        currentFile = file;
        originalSize = file.size;
        const ext = getFileExt(file.name);

        // Update Upload Preview
        uploadFilename.textContent = file.name;
        uploadFilesize.textContent = formatBytes(file.size);
        uploadFileBadge.textContent = ext;
        uploadFileBadge.className = `file-badge ${ext.toLowerCase()}`;

        dropZone.classList.add('hidden');
        uploadFilePreview.classList.remove('hidden');
    };

    removeFileBtn.addEventListener('click', () => {
        currentFile = null;
        fileInput.value = '';
        dropZone.classList.remove('hidden');
        uploadFilePreview.classList.add('hidden');
    });

    goConfigureBtn.addEventListener('click', () => {
        // Setup Settings UI
        originalFilename.textContent = currentFile.name;
        originalFilesize.textContent = formatBytes(currentFile.size);
        const ext = getFileExt(currentFile.name);
        settingsFileBadge.textContent = ext;
        settingsFileBadge.className = `file-badge ${ext.toLowerCase()}`;

        if (currentFile.type === 'application/pdf') {
            dimensionsGroup.classList.add('hidden');
            if (qualityGroup) qualityGroup.classList.add('hidden');
        } else {
            dimensionsGroup.classList.remove('hidden');
            if (qualityGroup) qualityGroup.classList.remove('hidden');
        }

        showSection(settingsSection, 1);
    });

    // Drag and Drop
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            handleFile(e.dataTransfer.files[0]);
        }
    });

    // Browse Button
    browseBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
            handleFile(e.target.files[0]);
        }
    });

    // --- Compression Logic ---
    compressBtn.addEventListener('click', async () => {
        if (!currentFile) return;

        showSection(processSection, 2);

        let targetMB = '';
        const targetUnit = document.getElementById('target-size-unit').value;
        if (targetSizeInput.value) {
            const val = parseFloat(targetSizeInput.value);
            targetMB = targetUnit === 'KB' ? val / 1024 : val;
        }

        const formData = new FormData();
        formData.append('file', currentFile);
        if (targetMB) formData.append('targetSizeMB', targetMB);
        if (qualitySlider && qualitySlider.value) formData.append('quality', qualitySlider.value);
        if (targetWidthInput.value) formData.append('targetWidth', targetWidthInput.value);
        if (targetHeightInput.value) formData.append('targetHeight', targetHeightInput.value);

        try {
            const response = await fetch('/compress', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Compression failed');
            }

            compressedFileBlob = await response.blob();

            // Generate Preview URL
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            objectUrl = URL.createObjectURL(compressedFileBlob);

            showResults();
        } catch (err) {
            console.error(err);
            alert('Error compressing file: ' + err.message);
            showSection(settingsSection, 1);
        }
    });

    // --- Results Handlers ---
    const showResults = () => {
        const newSize = compressedFileBlob.size;
        const savedBytes = originalSize - newSize;
        const savedPercent = originalSize > 0 ? ((savedBytes / originalSize) * 100).toFixed(1) : 0;

        resultOriginalSize.textContent = formatBytes(originalSize);
        resultNewSize.textContent = formatBytes(newSize);
        resultSavedPercent.textContent = savedPercent > 0 ? `${savedPercent}%` : '0%';

        // Generate Preview URL
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(compressedFileBlob);

        // Setup Download
        downloadBtn.href = objectUrl;
        downloadBtn.download = `compressed_${currentFile.name}`;

        showSection(resultSection, 3);
    };

    viewBtn.addEventListener('click', () => {
        if (objectUrl) {
            window.open(objectUrl, '_blank');
        }
    });

    startOverBtn.addEventListener('click', () => {
        currentFile = null;
        compressedFileBlob = null;
        fileInput.value = '';
        targetSizeInput.value = '';
        targetWidthInput.value = '';
        targetHeightInput.value = '';
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = null;

        dropZone.classList.remove('hidden');
        uploadFilePreview.classList.add('hidden');

        showSection(uploadSection, 0);
    });
});
