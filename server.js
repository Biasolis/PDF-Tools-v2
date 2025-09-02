const express = require('express');
const path = require('path');
const fs = require('fs');
const pdfRoutes = require('./routes/pdfRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware para processar corpos de requisição JSON
app.use(express.json());

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/', pdfRoutes);

// --- Rotina de Limpeza de Sessões Expiradas ---
const uploadDir = path.join(__dirname, 'uploads');
const FOLDER_EXPIRATION_MS = 60 * 60 * 1000; // 1 hora

// Cria a pasta de uploads se ela não existir
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

setInterval(() => {
    console.log('Executando rotina de limpeza de uploads...');
    fs.readdir(uploadDir, (err, sessionFolders) => {
        if (err) return console.error('Falha ao ler o diretório de uploads:', err);
        
        sessionFolders.forEach(folder => {
            const folderPath = path.join(uploadDir, folder);
            fs.stat(folderPath, (err, stats) => {
                if (err || !stats.isDirectory()) return;
                const folderAge = Date.now() - stats.mtime.getTime();
                if (folderAge > FOLDER_EXPIRATION_MS) {
                    console.log(`Removendo pasta de sessão expirada: ${folderPath}`);
                    fs.rm(folderPath, { recursive: true, force: true }, (err) => {
                        if (err) console.error(`Falha ao remover a pasta ${folderPath}:`, err);
                    });
                }
            });
        });
    });
}, FOLDER_EXPIRATION_MS / 2); // Executa a cada 30 minutos

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta http://localhost:${PORT}`);
});