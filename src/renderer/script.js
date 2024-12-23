const { ipcRenderer } = require("electron");
const pdfjsLib = require("pdfjs-dist");
const path = require("path");
let isDebugMode = false;

const debugSpan = document.getElementById("debug");

debugSpan.addEventListener("click", () => {
  isDebugMode = !isDebugMode;
  ipcRenderer.send("toggle-debug", isDebugMode);
});

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

  // First pass: handle O0X patterns in time values
  text = text.replace(
    /(\d+)a,\s*O0(\d+)m,\s*(\d+)d/gi,
    (match, years, months, days) => {
      return `${years}a, 0${months}m, ${days}d`;
    }
  );

  // Second pass: handle remaining time format patterns
  text = text.replace(
    /(\d|[OoSlBá])(\d|[OoSlBá])(a,|m,|d)|(\d|[OoSlBá])([OoSlBá])(a,|m,|d)|([OoSlBá])(\d|[OoSlBá])(a,|m,|d)/g,
    (match) => {
      return match
        .replace(/[Oo]/g, "0")
        .replace(/[S]/g, "5")
        .replace(/[l]/g, "1")
        .replace(/[B]/g, "8")
        .replace(/[á]/g, "4");
    }
  );

  return text;
}

async function extractPDFData(filePath) {
  const data = await pdfjsLib.getDocument(`file://${filePath}`).promise;
  let fullText = "";
  let profile = "";
  let currentProfile = "";
  let result = "";

  // Get full text from PDF
  for (let i = 1; i <= data.numPages; i++) {
    const page = await data.getPage(i);
    const textContent = await page.getTextContent();
    if (textContent && textContent.items) {
      textContent.items.forEach((item) => {
        fullText += item.str + " ";
      });
    }
  }

  // Clean up text
  fullText = fullText.replace(/\s+/g, " ").trim();

  // Extract initial profile
  let profileMatch = fullText.match(
    /Perfil contributivo : \d+ - Aposentadoria por[^]*?(?=\s*Regra de direito|\s*Página|\s*=|\s*Anexo ID|$)/
  );

  if (profileMatch) {
    profile = profileMatch[0].trim();
  } else {
    fullText = await extractTextFromImageOCR(filePath);
    fullText = fullText.replace(/\s+/g, " ").trim();
    fullText = normalizeOCRNumbers(fullText);
    profileMatch = fullText.match(
      /Perfil contributivo : \d+ - Aposentadoria por[^]*?(?=\s*Regra de direito|\s*Página|\s*=|\s*Anexo ID|$)/
    );
    profile = profileMatch[0].trim();
  }

  // Extract blocks
  const blocks =
    fullText.match(
      /Analise do direito em [\d\/]+[\s\S]+?(?=Analise do direito em|$)/g
    ) || [];

  // Process blocks
  let profileBlocks = new Map(); // Track blocks for each profile
  let profileDates = new Map(); // Track dates for each profile

  currentProfile = profile;
  result += `<span class="beneficio">${currentProfile}</span>\n\n\n`;
  profileBlocks.set(currentProfile, new Set());
  profileDates.set(currentProfile, { latestDate: null, latestDateStr: null });

  blocks.forEach((block) => {
    const normalizedBlock = block.replace(/\s+/g, " ").trim();
    console.log("Normalized Block:", normalizedBlock);

    const profileMatch = normalizedBlock.match(
      /Perfil contributivo : \d+ - Aposentadoria por[^]*?(?=\s*Regra de direito|\s*Página|\s*=|\s*Anexo ID|$)/
    );

    if (profileMatch && profileMatch[0].trim() !== currentProfile) {
      currentProfile = profileMatch[0].trim();
      result += `<span class="beneficio">${currentProfile}</span>\n\n\n`;
      if (!profileBlocks.has(currentProfile)) {
        profileBlocks.set(currentProfile, new Set());
        profileDates.set(currentProfile, {
          latestDate: null,
          latestDateStr: null,
        });
      }
    }

    const dateMatch = normalizedBlock.match(/Analise do direito em ([\d\/]+)/);
    const timeMatch = normalizedBlock.match(
      /(?:Total de tempo c\/conversao|Tempo de contribuicao)(?:\s+\d+)?(?:\s*[:;]+\s*|\s+)([\d]+a,\s*[\d]+m,\s*[\d]+d)/
    );
    const carenciaMatch = normalizedBlock.match(
      /Quantidade de carencia(?:\s+\d+)?(?:\s*[:;]+\s*|\s+)(\d+)/
    );

    if (dateMatch && timeMatch && carenciaMatch) {
      const date = dateMatch[1];
      const blockKey = `${date}_${timeMatch[1]}_${carenciaMatch[1]}`;

      if (!profileBlocks.get(currentProfile).has(blockKey)) {
        profileBlocks.get(currentProfile).add(blockKey);

        if (date) {
          const [day, month, year] = date.split("/").map(Number);
          const currentDate = new Date(year, month - 1, day);
          const profileDateInfo = profileDates.get(currentProfile);

          if (
            !profileDateInfo.latestDate ||
            currentDate > profileDateInfo.latestDate
          ) {
            profileDateInfo.latestDate = currentDate;
            profileDateInfo.latestDateStr = date;
          }
        }
        const isDER = date === profileDates.get(currentProfile).latestDateStr;
        result += `<span class="analiseDireito">Analise do direito em ${date}${
          isDER ? " (DER)" : ""
        }</span>\n\n`;
        result += `Tempo de contribuição : ${timeMatch[1]}\n`;
        result += `Quantidade de carência : ${carenciaMatch[1]}\n\n\n`;
      }
    }
  });

  return result;
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
