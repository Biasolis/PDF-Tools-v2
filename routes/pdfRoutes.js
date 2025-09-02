// Arquivo: routes/pdfRoutes.js
// Versão final consolidando a V1 (ferramentas) e a V2 (editor com upload)

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { PDFDocument } = require('pdf-lib');
const mammoth = require('mammoth');
const puppeteer = require('puppeteer');
const pdfParse = require('pdf-parse');
const { exec } = require('child_process');
const { zip } = require('zip-a-folder');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// --- Helpers ---
function cleanFileName(fileName) {
    if (!fileName) return '';
    return fileName.replace(/_unido_.*|_comprimido_.*|_pdfa_.*|_separado_.*|_jpg_.*|_convertido_.*/i, '');
}

function runExec(command) {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`Exec Error for command "${command}":`, stderr);
                return reject(error);
            }
            resolve(stdout);
        });
    });
}

// --- Configuração ---
const uploadDir = path.join(__dirname, '..', 'uploads');
const documentsDir = path.join(__dirname, '..', 'documents');
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(documentsDir, { recursive: true });

// Multer para uploads de sessão (tarefas)
const sessionUploadStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const sessionPath = path.join(uploadDir, req.params.sessionId);
        fs.mkdirSync(sessionPath, { recursive: true });
        cb(null, sessionPath);
    },
    filename: (req, file, cb) => cb(null, file.originalname)
});
const sessionUpload = multer({ storage: sessionUploadStorage });

// Multer para uploads de edição (documentos permanentes)
const documentStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, documentsDir);
    },
    filename: (req, file, cb) => {
        // Para evitar sobreescrever arquivos, adicionamos um timestamp ao nome
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `${uniqueSuffix}-${file.originalname}`);
    }
});
const uploadDocument = multer({ storage: documentStorage });

const jobs = new Map();

// =======================================================
// ROTAS DA APLICAÇÃO
// =======================================================

// --- Rota Principal ---
router.get('/', (req, res) => res.render('index', { title: 'Ferramenta PDF & DOCX Completa' }));


// --- Rotas de Sessão e Jobs (V1 - Ferramentas) ---
router.post('/session/create', (req, res) => {
    const sessionId = uuidv4();
    jobs.set(sessionId, { status: 'created' });
    res.status(201).json({ sessionId });
});

router.post('/session/upload/:sessionId', sessionUpload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    res.status(200).json({ fileId: req.file.filename });
});

router.post('/session/execute/:sessionId', (req, res) => {
    const { tool, files } = req.body;
    if (!jobs.has(req.params.sessionId)) return res.status(404).json({ error: 'Sessão não encontrada.' });
    processJob(req.params.sessionId, tool, files);
    res.status(202).json({ message: 'Processamento iniciado.' });
});

router.get('/session/status/:sessionId', (req, res) => {
    const job = jobs.get(req.params.sessionId);
    if (!job) return res.status(404).json({ error: 'Trabalho não encontrado.' });
    res.status(200).json(job);
});

router.get('/download/:sessionId/:fileName', (req, res) => {
    const { sessionId, fileName } = req.params;
    const filePath = path.join(uploadDir, sessionId, fileName);
    if (fs.existsSync(filePath)) {
        res.download(filePath, fileName, (err) => {
            if (!err) {
                fs.rm(path.join(uploadDir, sessionId), { recursive: true, force: true }, () => {});
                jobs.delete(sessionId);
            }
        });
    } else {
        res.status(404).send('Arquivo não encontrado ou a sessão expirou.');
    }
});

// Rota Síncrona (Rápida)
router.post('/pdf-para-docx', multer({ storage: multer.memoryStorage() }).single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    try {
        const data = await pdfParse(req.file.buffer);
        const htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><p>${data.text.replace(/\n/g, '<br>')}</p></body></html>`;
        const docFileName = req.file.originalname.replace(/\.pdf$/, '.doc');
        res.setHeader('Content-Type', 'application/msword');
        res.setHeader('Content-Disposition', `attachment; filename=${docFileName}`);
        res.send(htmlContent);
    } catch (error) {
        res.status(500).json({ error: 'Ocorreu um erro ao extrair texto do PDF.' });
    }
});


// --- ROTAS PARA O EDITOR V2 (WOPI INTEGRATION) ---

// Rota para upload de arquivos para o editor
router.post('/upload-for-editing', uploadDocument.single('document'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }
    // Retorna a URL do editor para o arquivo que acabou de ser salvo
    res.status(200).json({
        editorUrl: `/editor/${req.file.filename}`
    });
});

// Rota para renderizar a página do editor
router.get('/editor/:fileName', (req, res) => {
    const { fileName } = req.params;
    const wopiClientUrl = `${process.env.APP_PUBLIC_URL}/wopi/files/${fileName}`;
    const accessToken = 'token_para_teste_seguro';

    res.render('editor', { 
        title: `Editando: ${fileName}`,
        wopiClientUrl: wopiClientUrl,
        accessToken: accessToken
    });
});

// API WOPI: Fornece informações do arquivo para o Collabora
router.get('/wopi/files/:fileName', (req, res) => {
    const { fileName } = req.params;
    const filePath = path.join(documentsDir, fileName);

    // Se o arquivo não existir (ex: 'novo-documento.docx'), cria a partir de um template.
    if (!fs.existsSync(filePath)) {
        const templatePath = path.join(__dirname, '..', 'template-vazio.docx');
        if (fs.existsSync(templatePath)) {
            fs.copyFileSync(templatePath, filePath);
        } else {
            fs.writeFileSync(filePath, ''); 
        }
    }

    try {
        const stats = fs.statSync(filePath);
        res.json({
            BaseFileName: fileName,
            OwnerId: 'admin',
            Size: stats.size,
            UserId: 'user',
            Version: stats.mtime.getTime().toString(),
            UserCanWrite: true,
            SupportsUpdate: true,
        });
    } catch (error) {
         res.status(404).send('Arquivo não encontrado');
    }
});

// API WOPI: Fornece o conteúdo do arquivo para o Collabora
router.get('/wopi/files/:fileName/contents', (req, res) => {
    const { fileName } = req.params;
    const filePath = path.join(documentsDir, fileName);
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send('Arquivo não encontrado');
    }
});

// API WOPI: Recebe o conteúdo atualizado do Collabora e salva
router.post('/wopi/files/:fileName/contents', (req, res) => {
    const { fileName } = req.params;
    const filePath = path.join(documentsDir, fileName);
    
    const stream = fs.createWriteStream(filePath);
    req.pipe(stream);
    stream.on('finish', () => res.sendStatus(200));
    stream.on('error', () => res.sendStatus(500));
});


// =======================================================
// LÓGICA DE PROCESSAMENTO EM SEGUNDO PLANO (V1 - Ferramentas)
// =======================================================
async function processJob(sessionId, tool, files) {
    jobs.set(sessionId, { status: 'processing' });
    const sessionPath = path.join(uploadDir, sessionId);

    try {
        let outputFileName;
        const inputFile = files ? path.join(sessionPath, files[0]) : null;
        const outputFile = path.join(sessionPath, `output_${sessionId}.tmp`);
        const baseFileName = files ? cleanFileName(files[0]) : '';

        switch (tool) {
            case 'unir-pdf':
                outputFileName = `unido_${sessionId}.pdf`;
                const mergedPdf = await PDFDocument.create();
                for (const fileName of files) {
                    const fileBuffer = fs.readFileSync(path.join(sessionPath, fileName));
                    const pdf = await PDFDocument.load(fileBuffer);
                    const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
                    copiedPages.forEach(page => mergedPdf.addPage(page));
                }
                fs.writeFileSync(path.join(sessionPath, outputFileName), await mergedPdf.save());
                break;
            
            case 'comprimir-pdf':
                outputFileName = baseFileName.replace(/\.pdf$/i, `_comprimido_${sessionId}.pdf`);
                await runExec(`gs -dSAFER -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/screen -dNOPAUSE -dQUIET -dBATCH -sOutputFile=${outputFile} ${inputFile}`);
                fs.renameSync(outputFile, path.join(sessionPath, outputFileName));
                break;

            case 'docx-para-pdf':
                outputFileName = baseFileName.replace(/\.docx?$/i, `_${sessionId}.pdf`);
                const { value: html } = await mammoth.convertToHtml({ path: inputFile });
                const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
                const page = await browser.newPage();
                await page.setContent(html, { waitUntil: 'networkidle0' });
                fs.writeFileSync(path.join(sessionPath, outputFileName), await page.pdf({ format: 'A4', printBackground: true, margin: { top: '2.5cm', right: '2.5cm', bottom: '2.5cm', left: '2.5cm' } }));
                await browser.close();
                break;

            case 'pdf-para-pdfa':
                outputFileName = baseFileName.replace(/\.pdf$/i, `_pdfa_${sessionId}.pdf`);
                const gsDefPath = '/usr/share/ghostscript/9.55.0/lib/PDFA_def.ps';
                await runExec(`gs -dPDFA=2 -dBATCH -dNOPAUSE -sDEVICE=pdfwrite -sColorConversionStrategy=UseDeviceIndependentColor -sOutputFile=${outputFile} ${gsDefPath} ${inputFile}`);
                fs.renameSync(outputFile, path.join(sessionPath, outputFileName));
                break;

            case 'pdf-para-jpg':
                outputFileName = baseFileName.replace(/\.pdf$/i, `_jpg_${sessionId}.zip`);
                const jpgOutputDir = path.join(sessionPath, 'jpg_output');
                if (!fs.existsSync(jpgOutputDir)) fs.mkdirSync(jpgOutputDir);
                await runExec(`pdftoppm -jpeg ${inputFile} ${path.join(jpgOutputDir, 'page')}`);
                await zip(jpgOutputDir, path.join(sessionPath, outputFileName));
                break;
            
            case 'jpg-para-pdf':
            case 'png-para-pdf':
                outputFileName = `convertido_${sessionId}.pdf`;
                const inputFilePaths = files.map(f => `'${path.join(sessionPath, f)}'`).join(' ');
                await runExec(`convert ${inputFilePaths} ${path.join(sessionPath, outputFileName)}`);
                break;

            case 'separar-pdf':
                outputFileName = baseFileName.replace(/\.pdf$/i, `_separado_${sessionId}.zip`);
                const splitOutputDir = path.join(sessionPath, 'split_output');
                if (!fs.existsSync(splitOutputDir)) fs.mkdirSync(splitOutputDir);
                const originalPdf = await PDFDocument.load(fs.readFileSync(inputFile));
                for (let i = 0; i < originalPdf.getPageCount(); i++) {
                    const newPdf = await PDFDocument.create();
                    const [copiedPage] = await newPdf.copyPages(originalPdf, [i]);
                    newPdf.addPage(copiedPage);
                    fs.writeFileSync(path.join(splitOutputDir, `pagina_${i + 1}.pdf`), await newPdf.save());
                }
                await zip(splitOutputDir, path.join(sessionPath, outputFileName));
                break;
            
            default:
                throw new Error(`Ferramenta '${tool}' desconhecida.`);
        }
        
        jobs.set(sessionId, { status: 'complete', downloadUrl: `/download/${sessionId}/${outputFileName}` });

    } catch (error) {
        console.error(`Erro no trabalho ${sessionId} (${tool}):`, error);
        jobs.set(sessionId, { status: 'error', message: `Falha em '${tool}'. Verifique o arquivo e tente novamente.` });
    }
}


module.exports = router;