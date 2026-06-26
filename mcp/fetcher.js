const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const { RBI_SOURCES } = require("./rbi-sources");

const DATA_DIR = path.join(__dirname, "data", "rbi-guidelines");
const REGISTRY_FILE = path.join(DATA_DIR, "_registry.json");

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readRegistry() {
  ensureDir();
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeRegistry(registry) {
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept: "application/pdf,application/octet-stream,*/*",
  "Accept-Language": "en-US,en;q=0.9",
};

function downloadFile(url, dest, referer) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const protocol = url.startsWith("https") ? https : http;
    const parsedUrl = new URL(url);

    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        ...REQUEST_HEADERS,
        ...(referer ? { Referer: referer } : {}),
      },
    };

    protocol.get(options, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        return resolve(downloadFile(response.headers.location, dest, url));
      }
      if (response.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        return reject(new Error(`HTTP ${response.statusCode} for ${url}`));
      }

      const contentType = response.headers["content-type"] || "";
      if (contentType && !contentType.includes("pdf") && !contentType.includes("octet-stream") && !contentType.includes("application/")) {
        let body = "";
        response.on("data", (chunk) => { body += chunk.toString(); });
        response.on("end", () => {
          file.close();
          try { fs.unlinkSync(dest); } catch {}
          if (body.includes("<!DOCTYPE") || body.includes("<html")) {
            reject(new Error(`Server returned HTML (${contentType}) instead of PDF for ${url}`));
          } else {
            reject(new Error(`Unexpected content-type: ${contentType} for ${url}`));
          }
        });
        return;
      }

      response.pipe(file);
      file.on("finish", () => {
        file.close();
        const stats = fs.statSync(dest);
        if (stats.size === 0) {
          try { fs.unlinkSync(dest); } catch {}
          return reject(new Error(`Downloaded empty file from ${url}`));
        }
        resolve();
      });
    }).on("error", (err) => {
      file.close();
      try { fs.unlinkSync(dest); } catch {}
      reject(err);
    });
  });
}

function extractTextFromPdf(pdfPath) {
  const data = fs.readFileSync(pdfPath);
  const pdfParse = require("pdf-parse");
  return pdfParse(data).then((result) => result.text);
}

async function fetchGuideline(source, force = false) {
  const registry = readRegistry();
  const existing = registry[source.id];

  const txtPath = path.join(DATA_DIR, `${source.id}.txt`);

  if (!force && existing && fs.existsSync(txtPath)) {
    return { id: source.id, status: "cached", fetchedAt: existing.fetchedAt };
  }

  console.error(`[fetcher] Downloading ${source.id}: ${source.name}`);
  const pdfPath = path.join(DATA_DIR, `${source.id}.pdf`);

  const urls = [source.url];
  if (source.fallbackUrl) {
    urls.push(source.fallbackUrl);
  }

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      if (i > 0) console.error(`[fetcher] Trying fallback URL for ${source.id}...`);
      await downloadFile(url, pdfPath);
      const stats = fs.statSync(pdfPath);

      console.error(`[fetcher] Extracting text from ${source.id}...`);
      const text = await extractTextFromPdf(pdfPath);

      fs.writeFileSync(txtPath, text);

      registry[source.id] = {
        name: source.name,
        category: source.category,
        url: url,
        fetchedAt: new Date().toISOString(),
        pageCount: Math.ceil(stats.size / 3000),
        fileSize: stats.size,
      };
      writeRegistry(registry);

      return { id: source.id, status: "downloaded", fetchedAt: registry[source.id].fetchedAt };
    } catch (err) {
      console.error(`[fetcher] Attempt ${i + 1}/${urls.length} failed for ${source.id}: ${err.message}`);
      if (i === urls.length - 1) {
        return { id: source.id, status: "error", error: err.message };
      }
    }
  }
}

async function fetchAllGuidelines(force = false) {
  const results = [];
  for (const source of RBI_SOURCES) {
    const result = await fetchGuideline(source, force);
    results.push(result);
  }
  return results;
}

function getCachedRegulations() {
  const registry = readRegistry();
  const result = [];
  for (const source of RBI_SOURCES) {
    const cached = registry[source.id];
    if (cached && fs.existsSync(path.join(DATA_DIR, `${source.id}.txt`))) {
      result.push({
        id: source.id,
        name: source.name,
        category: source.category,
        fetchedAt: cached.fetchedAt,
        pageCount: cached.pageCount || 0,
      });
    }
  }
  return result;
}

function getRegulationText(id) {
  const txtPath = path.join(DATA_DIR, `${id}.txt`);
  if (!fs.existsSync(txtPath)) {
    return null;
  }
  return fs.readFileSync(txtPath, "utf8");
}

function getRegistry() {
  return readRegistry();
}

module.exports = {
  fetchAllGuidelines,
  fetchGuideline,
  getCachedRegulations,
  getRegulationText,
  getRegistry,
  RBI_SOURCES,
};
