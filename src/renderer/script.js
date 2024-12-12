const { ipcRenderer } = require("electron");
const pdfjsLib = require("pdfjs-dist");
const path = require("path");

pdfjsLib.GlobalWorkerOptions.workerSrc = require("pdfjs-dist/build/pdf.worker.entry");

let selectedFilePath = null;

document.getElementById("loadPdfBtn").addEventListener("click", async () => {
  const result = await ipcRenderer.invoke("open-file-dialog");
  document.getElementById("extractionResult").textContent = "";
  updateCopyButtonState();

  if (!result.canceled) {
    selectedFilePath = result.filePaths[0];
    const fileName = selectedFilePath.split("\\").pop().split("/").pop();
    document.getElementById(
      "selectedFile"
    ).textContent = `Arquivo selecionado: ${fileName}`;
  }
});

document.getElementById("copyBtn").addEventListener("click", () => {
  const resultDiv = document.getElementById("extractionResult");
  const textContent = resultDiv.textContent;
  navigator.clipboard.writeText(textContent).then(() => {
    const originalText = document.getElementById("copyBtn").textContent;
    document.getElementById("copyBtn").textContent = "Copiado!";
    setTimeout(() => {
      document.getElementById("copyBtn").textContent = originalText;
    }, 2000);
  });
});

function updateCopyButtonState() {
  const resultDiv = document.getElementById("extractionResult");
  const copyBtn = document.getElementById("copyBtn");
  copyBtn.disabled = !resultDiv.textContent.trim();
}

async function extractTextFromImageOCR(pdfPath) {
  const pdf2img = require("pdf-poppler");
  const fs = require("fs");

  const tempDir = path.join(path.dirname(pdfPath), ".temp_ocr");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
  }

  try {
    const opts = {
      format: "png",
      out_dir: tempDir,
      out_prefix: "page",
      page: null,
      density: 300,
      quality: 100,
      scale: 2250,
    };

    const progressBar = document.getElementById("progressBar");
    const progressLabel = document.getElementById("progressLabel");
    progressBar.style.display = "block";
    progressLabel.style.display = "block";
    progressBar.value = 0;
    progressLabel.textContent = "Extraindo Imagens do PDF";

    await pdf2img.convert(pdfPath, opts);
    progressBar.value = 50;

    progressLabel.textContent = "Extraindo texto";

    const files = fs
      .readdirSync(opts.out_dir)
      .filter((f) => f.startsWith("page"));

    const totalFiles = files.length;
    let processedFiles = 0;

    // Process all images in parallel
    const textPromises = files.map(async (file) => {
      const imagePath = path.join(opts.out_dir, file);
      const text = await ipcRenderer.invoke("process-ocr", imagePath);
      fs.unlinkSync(imagePath);

      processedFiles++;
      progressBar.value = 50 + (processedFiles / totalFiles) * 50;
      return text;
    });

    const texts = await Promise.all(textPromises);
    await ipcRenderer.invoke("cleanup-ocr");
    fs.rmdirSync(tempDir);
    progressBar.style.display = "none";
    progressLabel.style.display = "none";
    return texts.join("\n");
  } catch (error) {
    console.error("Error in OCR processing:", error);
    throw error;
  }
}

function normalizeOCRNumbers(text) {
  // Normalize "Quantidade de carencia" numbers - only the value after ":"
  text = text.replace(/Quantidade de carencia:\s*(\d+)/g, (match, num) => {
    return `Quantidade de carencia: ${num
      .replace(/[Oo]/g, "0")
      .replace(/[S]/g, "5")}`;
  });

  // Normalize "Tempo de contribuicao" format - only the value after ":"
  text = text.replace(
    /(Tempo de contribuicao\s*:\s*)(\d|[Oo]|[l]|[S]){2}a,\s*(\d|[Oo]|[l]|[S]){2}m,\s*(\d|[Oo]|[l]|[S]){2}d/g,
    (match, prefix, ...groups) => {
      return (
        prefix +
        match
          .slice(prefix.length)
          .replace(/[Oo]/g, "0")
          .replace(/[l]/g, "1")
          .replace(/[S]/g, "5")
      );
    }
  );

  return text;
}

async function extractPDFData(filePath) {
  const data = await pdfjsLib.getDocument(`file://${filePath}`).promise;
  let fullText = "";
  let profile = "";

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

  let profileMatch = fullText.match(
    /Perfil contributivo : \d+ - Aposentadoria por[^]*?(?=Regra de direito|$)/
  );

  if (profileMatch) {
    profile = profileMatch[0].trim();
  } else {
    fullText = await extractTextFromImageOCR(filePath);
    fullText = fullText.replace(/\s+/g, " ").trim();
    fullText = normalizeOCRNumbers(fullText);
    console.log(`OCR Text: ${fullText}`);
    profileMatch = fullText.match(
      /Perfil contributivo : \d+ - Aposentadoria por[^]*?(?=Regra de direito|$)/
    );
    profile = profileMatch[0].trim();
  }

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

  // Add DER marker to first block after removing duplicates
  if (uniqueBlocks.length > 0) {
    uniqueBlocks[0] = uniqueBlocks[0].replace(
      /Analise do direito em ([\d\/]+)/,
      "Analise do direito em $1 (DER)"
    );
  }

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
    document.getElementById("extractionResult").innerHTML = extractedText;
    updateCopyButtonState();
  } catch (error) {
    console.error("Error extracting PDF:", error);
    alert("Erro ao extrair dados do PDF");
  }
});
