document.addEventListener('DOMContentLoaded', () => {
    // =================================================================================
    // FUNÇÕES DE SETUP GERAIS (Iniciam os listeners para cada card)
    // =================================================================================
    setupUnirPdfTool();
    setupSimpleAsyncTool('comprimir-pdf');
    setupSimpleAsyncTool('docx-para-pdf');
    setupSimpleAsyncTool('pdf-para-pdfa');
    setupSimpleAsyncTool('pdf-para-jpg');
    setupSimpleAsyncTool('separar-pdf');
    setupMultiFileAsyncTool('jpg-para-pdf');
    setupMultiFileAsyncTool('png-para-pdf');
    setupSimpleSyncTool('pdf-para-docx');
    setupEditorUpload();

    // =================================================================================
    // LÓGICA PARA UPLOAD DO EDITOR V2
    // =================================================================================
    function setupEditorUpload() {
        const editorUploadInput = document.getElementById('editor-upload-input');
        const editorStatusEl = document.getElementById('editor-status');
        if (!editorUploadInput) return;

        editorUploadInput.addEventListener('change', async (event) => {
            const file = event.target.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append('document', file);

            showStatus(editorStatusEl, `Enviando ${file.name}...`, 'processing');
            editorUploadInput.disabled = true;

            try {
                const response = await fetch('/upload-for-editing', {
                    method: 'POST',
                    body: formData,
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error || 'Falha no upload do arquivo.');
                }

                const data = await response.json();
                window.location.href = data.editorUrl;

            } catch (error) {
                showStatus(editorStatusEl, error.message, 'error');
                editorUploadInput.disabled = false;
            }
        });
    }

    // =================================================================================
    // LÓGICA ESPECÍFICA DA FERRAMENTA DE UNIR PDF
    // =================================================================================
    function setupUnirPdfTool() {
        const toolId = 'unir-pdf';
        const cardEl = document.getElementById(`${toolId}-card`);
        if (!cardEl) return;

        const input = document.getElementById(`${toolId}-input`);
        const button = document.getElementById(`${toolId}-button`);
        const previewArea = document.getElementById('pdf-preview-area');
        const statusEl = document.getElementById(`${toolId}-status`);
        const addButtonLabel = cardEl.querySelector('label');
        let sessionData = null;

        if (window.pdfjsLib) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js`;
        }
        new Sortable(previewArea, { animation: 150, ghostClass: 'sortable-ghost' });

        input.addEventListener('change', async (event) => {
            if (!sessionData) {
                sessionData = await startNewSession(statusEl);
                if (!sessionData) return;
            }
            const files = Array.from(event.target.files);
            input.disabled = true;
            addButtonLabel.classList.add('cursor-not-allowed', 'opacity-50');

            for (const file of files) {
                const card = generatePreviewCard(file);
                await uploadAndTrackFile(sessionData, file, card);
            }
            
            input.disabled = false;
            addButtonLabel.classList.remove('cursor-not-allowed', 'opacity-50');
            updateMergeButtonState();
            event.target.value = '';
        });

        const generatePreviewCard = (file) => {
            const card = document.createElement('div');
            card.className = 'relative group bg-gray-100 p-2 rounded-lg shadow-sm cursor-grab';
            card.innerHTML = `
                <div class="absolute inset-0 bg-blue-200 rounded-lg progress-bar" style="width: 0%; transition: width 0.3s;"></div>
                <div class="relative">
                    <canvas class="w-full h-auto rounded bg-white"></canvas>
                    <p class="text-xs text-center truncate mt-1">${file.name}</p>
                    <button class="delete-btn absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity hidden">&times;</button>
                </div>
            `;
            previewArea.appendChild(card);
            
            const fileReader = new FileReader();
            fileReader.onload = async (e) => {
                try {
                    const typedarray = new Uint8Array(e.target.result);
                    const pdf = await pdfjsLib.getDocument({ data: typedarray }).promise;
                    const page = await pdf.getPage(1);
                    const canvas = card.querySelector('canvas');
                    const context = canvas.getContext('2d');
                    const viewport = page.getViewport({ scale: 0.5 });
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;
                    await page.render({ canvasContext: context, viewport: viewport }).promise;
                } catch (error) {
                    card.querySelector('.relative').innerHTML += `<div class="absolute inset-0 bg-red-100 flex items-center justify-center"><p class="text-xs text-red-700 text-center">Erro ao ler PDF</p></div>`;
                }
            };
            fileReader.readAsArrayBuffer(file);
            return card;
        };
        
        const uploadAndTrackFile = async (session, file, card) => {
            session.files.set(card, { originalName: file.name, serverId: null, status: 'uploading' });
            
            const progressBar = card.querySelector('.progress-bar');
            
            const uploadData = await uploadFileWithProgress(session.sessionId, file, (percent) => {
                progressBar.style.width = `${percent}%`;
            });

            if (uploadData && uploadData.fileId) {
                session.files.get(card).serverId = uploadData.fileId;
                session.files.get(card).status = 'uploaded';
                const deleteBtn = card.querySelector('.delete-btn');
                deleteBtn.classList.remove('hidden');
                deleteBtn.addEventListener('click', () => {
                    card.remove();
                    session.files.delete(card);
                    updateMergeButtonState();
                });
            } else {
                card.querySelector('.relative').innerHTML += `<div class="absolute inset-0 bg-red-100 flex items-center justify-center"><p class="text-xs text-red-700 text-center">Falha no Upload</p></div>`;
                session.files.get(card).status = 'error';
            }
        };

        const updateMergeButtonState = () => {
            if (!sessionData) return;
            const filesReady = Array.from(sessionData.files.values()).filter(f => f.status === 'uploaded').length;
            button.disabled = filesReady < 2;
        };

        button.addEventListener('click', async () => {
            const orderedCards = Array.from(previewArea.children);
            const orderedFileIds = orderedCards.map(card => sessionData.files.get(card)?.serverId).filter(id => id);
            
            showStatus(statusEl, 'Iniciando a união...', 'processing');
            button.disabled = true;
            addButtonLabel.classList.add('hidden');
            input.disabled = true;

            try {
                const response = await fetch(`/session/execute/${sessionData.sessionId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tool: toolId, files: orderedFileIds })
                });
                if (!response.ok) throw new Error((await response.json()).error || 'Falha ao iniciar a tarefa.');
                pollJobStatus(sessionData.sessionId, statusEl, button, addButtonLabel, input);
            } catch (error) {
                showStatus(statusEl, `Erro: ${error.message}`, 'error');
                button.disabled = false;
                addButtonLabel.classList.remove('hidden');
                input.disabled = false;
            }
        });
    }

    // =================================================================================
    // SETUPERS GENÉRICOS PARA AS OUTRAS FERRAMENTAS
    // =================================================================================

    function setupMultiFileAsyncTool(toolId) {
        const input = document.getElementById(`${toolId}-input`);
        const button = document.getElementById(`${toolId}-button`);
        const statusEl = document.getElementById(`${toolId}-status`);
        if (!button || !input) return;

        let sessionData = null;
        let uploadedFileIds = [];

        input.addEventListener('change', async (event) => {
            if (!sessionData) {
                sessionData = await startNewSession(statusEl);
                if (!sessionData) return;
            }
            
            const files = Array.from(event.target.files);
            input.disabled = true;
            button.disabled = true;

            showStatus(statusEl, `Enviando ${files.length} arquivos...`, 'progress', 5);
            
            const uploadPromises = files.map(file => uploadSingleFile(sessionData.sessionId, file));
            const results = await Promise.all(uploadPromises);
            
            uploadedFileIds = results.filter(r => r && r.fileId).map(r => r.fileId);

            input.disabled = false;
            button.disabled = false;
            if(uploadedFileIds.length === files.length) {
                showStatus(statusEl, `${files.length} arquivos prontos. Clique para converter.`, 'success');
            } else {
                showStatus(statusEl, `Erro no upload de ${files.length - uploadedFileIds.length} arquivos.`, 'error');
            }
        });

        button.addEventListener('click', async () => {
            if (uploadedFileIds.length === 0) {
                showStatus(statusEl, 'Selecione pelo menos um arquivo.', 'error'); return;
            }
            button.disabled = true;
            input.disabled = true;
            showStatus(statusEl, 'Iniciando processamento no servidor...', 'processing');

            try {
                const executeResponse = await fetch(`/session/execute/${sessionData.sessionId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tool: toolId, files: uploadedFileIds })
                });

                if (!executeResponse.ok) {
                    throw new Error((await executeResponse.json()).error || 'Falha ao iniciar o trabalho.');
                }
                
                pollJobStatus(sessionData.sessionId, statusEl, button, null, input);
                sessionData = null;
                uploadedFileIds = [];
                input.value = '';
            } catch (error) {
                showStatus(statusEl, error.message, 'error');
                button.disabled = false;
                input.disabled = false;
            }
        });
    }

    function setupSimpleAsyncTool(toolId) {
        const input = document.getElementById(`${toolId}-input`);
        const button = document.getElementById(`${toolId}-button`);
        const statusEl = document.getElementById(`${toolId}-status`);
        if (!button || !input) return;

        button.addEventListener('click', async () => {
            if (input.files.length === 0) { showStatus(statusEl, 'Selecione um arquivo.', 'error'); return; }
            const file = input.files[0];
            button.disabled = true;
            input.disabled = true;

            showStatus(statusEl, 'Iniciando sessão...', 'info');
            const sessionData = await startNewSession(statusEl);
            if (!sessionData) { button.disabled = false; input.disabled = false; return; }

            const uploadData = await uploadFileWithProgress(sessionData.sessionId, file, (percent) => {
                showStatus(statusEl, `Enviando: ${Math.round(percent)}%`, 'progress', percent);
            });
            if (!uploadData) { showStatus(statusEl, 'Falha no upload.', 'error'); button.disabled = false; input.disabled = false; return; }

            showStatus(statusEl, 'Iniciando processamento...', 'processing');
            try {
                const executeResponse = await fetch(`/session/execute/${sessionData.sessionId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tool: toolId, files: [uploadData.fileId] })
                });
                if (!executeResponse.ok) throw new Error((await executeResponse.json()).error || 'Falha ao iniciar a tarefa.');
                
                pollJobStatus(sessionData.sessionId, statusEl, button, null, input);
            } catch (error) {
                showStatus(statusEl, `Erro: ${error.message}`, 'error');
                button.disabled = false;
                input.disabled = false;
            }
        });
    }
    
    function setupSimpleSyncTool(toolId) {
        const input = document.getElementById(`${toolId}-input`);
        const button = document.getElementById(`${toolId}-button`);
        const statusEl = document.getElementById(`${toolId}-status`);
        if (!button || !input) return;
        
        button.addEventListener('click', async () => {
            if (input.files.length === 0) { showStatus(statusEl, 'Selecione um arquivo.', 'error'); return; }
            const file = input.files[0];
            button.disabled = true;
            input.disabled = true;

            const formData = new FormData();
            formData.append('file', file);
            showStatus(statusEl, 'Processando...', 'processing');
            try {
                const response = await fetch(`/${toolId}`, { method: 'POST', body: formData });
                if (!response.ok) throw new Error((await response.json()).error);
                const blob = await response.blob();
                const disposition = response.headers.get('content-disposition');
                const fileName = disposition ? disposition.split('filename=')[1].replace(/"/g, '') : `${toolId}-resultado`;
                createDownloadLink(blob, fileName, blob.type, statusEl);
            } catch (e) {
                showStatus(statusEl, `Falha: ${e.message}`, 'error');
            } finally {
                button.disabled = false;
                input.disabled = false;
            }
        });
    }

    // =================================================================================
    // FUNÇÕES DE APOIO (SESSÃO, UPLOAD COM PROGRESSO, UI, ETC.)
    // =================================================================================

    async function startNewSession(statusEl) {
        try {
            const response = await fetch('/session/create', { method: 'POST' });
            if (!response.ok) throw new Error('Falha ao criar sessão no servidor.');
            const data = await response.json();
            return { sessionId: data.sessionId, files: new Map() };
        } catch (error) {
            showStatus(statusEl, error.message, 'error');
            return null;
        }
    }
    
    function uploadFileWithProgress(sessionId, file, onProgress) {
        return new Promise((resolve, reject) => {
            const formData = new FormData();
            formData.append('file', file);
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `/session/upload/${sessionId}`, true);

            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const percentComplete = (event.loaded / event.total) * 100;
                    onProgress(percentComplete);
                }
            };
            xhr.onload = () => {
                try {
                    const response = JSON.parse(xhr.responseText);
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve(response);
                    } else {
                        reject(new Error(response.error || 'Falha no upload do arquivo.'));
                    }
                } catch (e) {
                    reject(new Error('Resposta inválida do servidor durante o upload.'));
                }
            };
            xhr.onerror = () => {
                reject(new Error('Erro de rede durante o upload.'));
            };
            xhr.send(formData);
        });
    }
    
    async function uploadSingleFile(sessionId, file) {
        const formData = new FormData();
        formData.append('file', file);
        try {
            const response = await fetch(`/session/upload/${sessionId}`, { method: 'POST', body: formData });
            if (!response.ok) return null;
            return await response.json();
        } catch (e) {
            return null;
        }
    }

    function pollJobStatus(sessionId, statusEl, button, addButtonLabel = null, input = null) {
        const interval = setInterval(async () => {
            try {
                const response = await fetch(`/session/status/${sessionId}`);
                if (!response.ok) {
                    clearInterval(interval);
                    showStatus(statusEl, 'Erro de comunicação com o servidor.', 'error');
                    if (button) button.disabled = false;
                    if (addButtonLabel) addButtonLabel.classList.remove('hidden');
                    if (input) input.disabled = false;
                    return;
                }
                const data = await response.json();
                
                if (data.status === 'processing') {
                    showStatus(statusEl, 'Servidor está processando...', 'processing');
                } else if (data.status === 'complete') {
                    clearInterval(interval);
                    createDownloadLinkFromUrl(data.downloadUrl, data.downloadUrl.split('/').pop(), statusEl);
                    if (button) button.disabled = false;
                    if (addButtonLabel) addButtonLabel.classList.remove('hidden');
                    if (input) input.disabled = false;
                    if (input) input.value = '';
                } else if (data.status === 'error') {
                    clearInterval(interval);
                    showStatus(statusEl, `Erro: ${data.message}`, 'error');
                    if (button) button.disabled = false;
                    if (addButtonLabel) addButtonLabel.classList.remove('hidden');
                    if (input) input.disabled = false;
                }
            } catch (e) {
                clearInterval(interval);
                showStatus(statusEl, 'Erro ao verificar status.', 'error');
                if (button) button.disabled = false;
                if (addButtonLabel) addButtonLabel.classList.remove('hidden');
                if (input) input.disabled = false;
            }
        }, 3000);
    }
    
    function showStatus(element, message, type, progress = 0) {
        if (!element) return;
        const container = element.querySelector('.progress-container');
        const bar = element.querySelector('.progress-bar');
        const text = element.querySelector('.status-text');

        if (!container || !bar || !text) {
            element.textContent = message;
            return;
        }

        bar.classList.remove('processing');
        text.classList.remove('text-red-600', 'text-green-600', 'text-gray-700');

        if (type === 'error') {
            container.style.display = 'none';
            text.textContent = message;
            text.classList.add('text-red-600');
        } else if (type === 'progress') {
            container.style.display = 'block';
            bar.style.width = `${progress}%`;
            text.textContent = message;
            text.classList.add('text-gray-700');
        } else if (type === 'processing') {
            container.style.display = 'block';
            bar.style.width = `100%`;
            bar.classList.add('processing');
            text.textContent = message;
            text.classList.add('text-gray-700');
        } else if (type === 'info') {
             container.style.display = 'none';
            text.textContent = message;
            text.classList.add('text-gray-700');
        } else if (type === 'success') {
            container.style.display = 'none';
            text.textContent = message;
            text.classList.add('text-green-600');
        } else { 
            container.style.display = 'none';
            text.innerHTML = '';
        }
    }

    function createDownloadLink(blob, fileName, mimeType, element) {
        const url = URL.createObjectURL(blob);
        const targetElement = element.querySelector('.status-text') || element;
        createDownloadLinkFromUrl(url, fileName, targetElement);
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    function createDownloadLinkFromUrl(url, fileName, element) {
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.className = 'inline-block bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-2 px-4 rounded-full transition-all duration-300';
        link.textContent = `Baixar ${fileName}`;
        element.innerHTML = '';
        element.appendChild(link);
    }
});