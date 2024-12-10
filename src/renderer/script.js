const { ipcRenderer } = require("electron");
const pdfjsLib = require("pdfjs-dist");
pdfjsLib.GlobalWorkerOptions.workerSrc = require("pdfjs-dist/build/pdf.worker.entry");

let selectedFilePath = null;

document.getElementById("loadPdfBtn").addEventListener("click", async () => {
  const result = await ipcRenderer.invoke("open-file-dialog");

  if (!result.canceled) {
    selectedFilePath = result.filePaths[0];
    const fileName = selectedFilePath.split("\\").pop().split("/").pop();
    document.getElementById(
      "selectedFile"
    ).textContent = `Arquivo selecionado: ${fileName}`;
  }
});

async function extractPDFData(filePath) {
  const data = await pdfjsLib.getDocument(`file://${filePath}`).promise;
  let fullText = "";

  for (let i = 1; i <= data.numPages; i++) {
    const page = await data.getPage(i);
    const textContent = await page.getTextContent();
    textContent.items.forEach((item) => {
      fullText += item.str + " ";
    });
  }

  // Extract only the first profile line
  const profileMatch = fullText.match(
    /Perfil\s+contributivo\s+:\s+4202\s+-\s+Aposentadoria\s+por\s+tempo\s+de\s+contribuicao\s+convencional/
  );
  const profile = profileMatch ? profileMatch[0].trim() : "";

  // Extract blocks with updated patterns
  const blocks = fullText.match(
    /Analise do direito em [\d\/]+[\s\S]+?(?=Analise do direito em|$)/g
  );

  let result = profile + "\n\n\n";

  blocks.forEach((block) => {
    console.log(`Block: ${block}`);
    const dateMatch = block.match(/Analise do direito em ([\d\/]+)/);
    const timeMatch = block.match(
      /Tempo\s+de\s+contribuicao\s+:\s+([\d]+a,\s*[\d]+m,\s*[\d]+d)/
    );
    const carenciaMatch = block.match(/Quantidade\s+de\s+carencia\s+:\s+(\d+)/);

    const date = dateMatch ? dateMatch[1] : "";
    const time = timeMatch ? timeMatch[1] : "";
    const carencia = carenciaMatch ? carenciaMatch[1] : "";

    result += `Analise do direito em ${date}\n\n`;
    result += `Tempo de contribuicao : ${time}\n`;
    result += `Quantidade de carencia : ${carencia}\n\n`;
  });

  return result;
}

// Update the extract button click handler:
document.getElementById("extractBtn").addEventListener("click", async () => {
  if (!selectedFilePath) {
    alert("Por favor, selecione um arquivo PDF primeiro.");
    return;
  }

  try {
    const extractedText = await extractPDFData(selectedFilePath);
    document.getElementById("extractionResult").textContent = extractedText;
  } catch (error) {
    console.error("Error extracting PDF:", error);
    alert("Erro ao extrair dados do PDF");
  }
});
