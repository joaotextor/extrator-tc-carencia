const { ipcRenderer } = require("electron");
const pdfjsLib = require("pdfjs-dist");
pdfjsLib.GlobalWorkerOptions.workerSrc = require("pdfjs-dist/build/pdf.worker.entry");

let selectedFilePath = null;

document.getElementById("loadPdfBtn").addEventListener("click", async () => {
  const result = await ipcRenderer.invoke("open-file-dialog");
  document.getElementById("extractionResult").textContent = "";

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
    if (textContent && textContent.items) {
      textContent.items.forEach((item) => {
        fullText += item.str + " ";
      });
    }
  }

  // Normalize spaces - replace multiple spaces with single space
  fullText = fullText.replace(/\s+/g, " ").trim();

  const profileMatch = fullText.match(
    /Perfil contributivo : \d+ - Aposentadoria por[^]*?(?=Regra de direito|$)/
  );
  const profile = profileMatch
    ? profileMatch[0].trim()
    : "Perfil não encontrado";

  const blocks =
    fullText.match(
      /Analise do direito em [\d\/]+[\s\S]+?(?=Analise do direito em|$)/g
    ) || [];

  let result = `<span class="beneficio">${profile}</span>` + "\n\n\n";

  blocks.forEach((block) => {
    // Normalize spaces in each block
    const normalizedBlock = block.replace(/\s+/g, " ").trim();

    if (normalizedBlock.includes("Tempo de contribuicao (bruto)")) {
      return;
    }

    const dateMatch = normalizedBlock.match(/Analise do direito em ([\d\/]+)/);
    const timeMatch = normalizedBlock.match(
      /Tempo de contribuicao : ([\d]+a, [\d]+m, [\d]+d)/
    );
    const carenciaMatch = normalizedBlock.match(
      /Quantidade de carencia : (\d+)/
    );

    const date = dateMatch ? dateMatch[1] : "";
    const time = timeMatch ? timeMatch[1] : "";
    const carencia = carenciaMatch ? carenciaMatch[1] : "";

    result += `<span class="analiseDireito">Analise do direito em ${date}</span>\n\n`;
    result += `Tempo de contribuicao : ${time}\n`;
    result += `Quantidade de carencia : ${carencia}\n\n\n`;
  });

  const newBlocks = result.split("\n\n\n");
  const newProfile = newBlocks[0];
  const uniqueBlocks = [...new Set(newBlocks.slice(1))];
  const finalResult = newProfile + "\n\n\n" + uniqueBlocks.join("\n\n\n");

  return finalResult;
}

document.getElementById("extractBtn").addEventListener("click", async () => {
  if (!selectedFilePath) {
    alert("Por favor, selecione um arquivo PDF primeiro.");
    return;
  }

  try {
    const extractedText = await extractPDFData(selectedFilePath);
    document.getElementById("extractionResult").innerHTML = extractedText; // Changed from textContent to innerHTML
  } catch (error) {
    console.error("Error extracting PDF:", error);
    alert("Erro ao extrair dados do PDF");
  }
});
