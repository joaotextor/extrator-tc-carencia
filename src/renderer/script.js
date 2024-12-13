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
  // Normalize "Quantidade de carencia" numbers
  text = text.replace(/Quantidade de carencia:\s*(\d+)/g, (match, num) => {
    return `Quantidade de carencia: ${num
      .replace(/[Oo]/g, "0")
      .replace(/[S]/g, "5")
      .replace(/[l]/g, "1")
      .replace(/[B]/g, "8")}`;
  });

  // New comprehensive pattern for time formats
  const replacements = {
    O: "0",
    o: "0",
    S: "5",
    l: "1",
    B: "8",
  };

  // Handle all three patterns for time values
  text = text.replace(
    /(\d|[OoSlB])(\d|[OoSlB])(a,|m,|d)|(\d|[OoSlB])([OoSlB])(a,|m,|d)|([OoSlB])(\d|[OoSlB])(a,|m,|d)/g,
    (match) => {
      return match
        .replace(/[Oo]/g, "0")
        .replace(/[S]/g, "5")
        .replace(/[l]/g, "1")
        .replace(/[B]/g, "8");
    }
  );

  return text;
}

async function extractPDFData(filePath) {
  const data = await pdfjsLib.getDocument(`file://${filePath}`).promise;
  let fullText = "";
  let profile = "";
  let earliestDate = null;
  let currentProfile = "";

  for (let i = 1; i <= data.numPages; i++) {
    const page = await data.getPage(i);
    const textContent = await page.getTextContent();
    if (textContent && textContent.items) {
      textContent.items.forEach((item) => {
        fullText += item.str + " ";
      });
    }
  }

  // Mantém apenas espaço simples.
  fullText = fullText.replace(/\s+/g, " ").trim();

  let profileMatch = fullText.match(
    /Perfil contributivo : \d+ - Aposentadoria por[^]*?(?=Regra de direito|$)/
  );

  if (profileMatch) {
    profile = profileMatch[0]
      .trim()
      .replace("contribuícao", "contribuição")
      .replace("contribuicao", "contribuição")
      .replace("contríbuicao", "contribuição");
  } else {
    fullText = await extractTextFromImageOCR(filePath);
    fullText = fullText.replace(/\s+/g, " ").trim();
    fullText = normalizeOCRNumbers(fullText);
    console.log(`OCR Text: ${fullText}`);
    profileMatch = fullText.match(
      /Perfil contributivo : \d+ - Aposentadoria por[^]*?(?=Regra de direito|$)/
    );
    profile = profileMatch[0]
      .trim()
      .replace("contribuícao", "contribuição")
      .replace("contribuicao", "contribuição")
      .replace("contríbuicao", "contribuição");
  }

  const blocks =
    fullText.match(
      /Analise do direito em [\d\/]+[\s\S]+?(?=Analise do direito em|$)/g
    ) || [];

  let result = "";
  currentProfile = profile;

  blocks.forEach((block) => {
    // Mantém apenas espaço simples.
    const normalizedBlock = block.replace(/\s+/g, " ").trim();

    const profileMatch = normalizedBlock.match(
      /Perfil contributivo : \d+ - Aposentadoria por[^]*?(?=Regra de direito|Anexo ID|$)/
    );

    if (
      profileMatch &&
      profileMatch[0]
        .replace("contribuícao", "contribuição")
        .replace("contribuicao", "contribuição")
        .replace("contríbuicao", "contribuição") !== currentProfile
    ) {
      currentProfile = profileMatch[0]
        .replace("contribuícao", "contribuição")
        .replace("contribuicao", "contribuição")
        .replace("contríbuicao", "contribuição");
      result += `<span class="beneficio">${currentProfile}</span>\n\n\n`;
    }

    // if (normalizedBlock.includes("Tempo de contribuicao (bruto)")) {
    //   return;
    // }

    const dateMatch = normalizedBlock.match(/Analise do direito em ([\d\/]+)/);
    const timeMatch = normalizedBlock.match(
      /(?:Tempo de contribuicao|Total de tempo comum)(?:\s+\d+)?\s*:?\s*([\d]+a,\s*[\d]+m,\s*[\d]+d)/
    );
    const carenciaMatch = normalizedBlock.match(
      /Quantidade de carencia(?:\s+\d+)?\s*:?\s*(\d+)/
    );

    const date = dateMatch ? dateMatch[1] : "";
    const time = timeMatch ? timeMatch[1] || timeMatch[2] : "";
    const carencia = carenciaMatch ? carenciaMatch[1] : "";

    if (date) {
      const [day, month, year] = date.split("/").map(Number);
      const currentDate = new Date(year, month - 1, day);

      if (!earliestDate || currentDate > earliestDate.date) {
        earliestDate = {
          date: currentDate,
          dateStr: date,
        };
      }
    }

    result += `<span class="analiseDireito">Analise do direito em ${date}</span>\n\n`;
    result += `Tempo de contribuição : ${time}\n`;
    result += `Quantidade de carência : ${carencia}\n\n\n`;
  });

  const newBlocks = result.split("\n\n\n");
  const newProfile = newBlocks[0];
  const uniqueBlocks = [...new Set(newBlocks.slice(1))];

  // Adiciona DER na data mais recente
  if (earliestDate && uniqueBlocks.length > 0) {
    uniqueBlocks.forEach((block, index) => {
      if (block.includes(earliestDate.dateStr)) {
        uniqueBlocks[index] = block.replace(
          /Analise do direito em ([\d\/]+)/,
          `Analise do direito em $1 (DER)`
        );
      }
    });
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
