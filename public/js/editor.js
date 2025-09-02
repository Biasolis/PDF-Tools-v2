// Este script é executado na página /editor/:fileName
document.addEventListener('DOMContentLoaded', () => {
    // A página EJS já nos forneceu o 'wopiClientUrl' e o 'accessToken'
    // que foram passados pelo nosso servidor Node.js
    const wopiClientUrl = window.wopiClientUrl;
    const accessToken = window.accessToken;

    async function loadEditor() {
        try {
            // 1. Descobre a URL de edição do Collabora
            const response = await fetch('/hosting/discovery');
            const discoveryXml = await response.text();
            const domParser = new DOMParser();
            const xmlDoc = domParser.parseFromString(discoveryXml, "text/xml");
            
            // Assume que estamos editando um docx por enquanto
            const actionNode = xmlDoc.querySelector('app[name="application/vnd.openxmlformats-officedocument.wordprocessingml.document"] action[name="edit"]');
            const editorUrlTemplate = actionNode.getAttribute('urlsrc');

            if (!editorUrlTemplate) {
                throw new Error("Não foi possível encontrar a URL de edição no discovery.xml");
            }
            
            // 2. Constrói a URL final do editor
            const editorUrl = `${editorUrlTemplate}WOPISrc=${encodeURIComponent(wopiClientUrl)}`;

            // 3. Define a action do formulário e o submete para carregar o iframe
            const form = document.getElementById('collabora-form');
            form.setAttribute('action', editorUrl);
            form.submit();

        } catch (error) {
            console.error("Erro ao carregar o editor Collabora:", error);
            alert("Não foi possível carregar o editor de documentos. Verifique o console para mais detalhes.");
        }
    }

    // Passa as variáveis do EJS para o escopo do script
    window.wopiClientUrl = document.body.dataset.wopiUrl;
    window.accessToken = document.body.dataset.accessToken;
    
    // Adiciona os dados ao body para o script poder pegá-los (uma forma de passar dados do EJS)
    const editorView = document.querySelector('div.w-full');
    editorView.insertAdjacentHTML('beforebegin', `
        <script>
            window.wopiClientUrl = "<%- wopiClientUrl %>";
            window.accessToken = "<%- accessToken %>";
        <\/script>
    `);
    
    loadEditor();
});