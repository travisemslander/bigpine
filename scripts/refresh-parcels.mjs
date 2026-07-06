#!/usr/bin/env node
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";

const args = parseArgs(process.argv.slice(2));

if (args.help || (!args.source && !args.county && !args.dataset)) {
  printHelp();
  process.exit(args.help ? 0 : 1);
}

const output = resolve(args.output || "data/parcels.geojson");
const metadataOutput = resolve(args.metadata || "data/metadata.json");
const scratchDir = resolve(args.scratch || "work/parcel-refresh");
mkdirSync(scratchDir, { recursive: true });

assertCommand("ogr2ogr", "GDAL is required. Install it with `brew install gdal` on macOS.");

const sourceInfo = args.source ? await sourceFromArgument(args.source) : await sourceFromGeocommons(args);
const downloaded = await ensureLocalFile(sourceInfo.url || sourceInfo.path, scratchDir);
const datasetPath = prepareDataset(downloaded);

const ogrArgs = [
  "-f",
  "GeoJSON",
  output,
  datasetPath,
  "-t_srs",
  "EPSG:4326",
  "-lco",
  "COORDINATE_PRECISION=6",
];

if (args.bbox) {
  const [xmin, ymin, xmax, ymax] = args.bbox.split(",").map(Number);
  if ([xmin, ymin, xmax, ymax].some((value) => Number.isNaN(value))) {
    fail("--bbox must be minLon,minLat,maxLon,maxLat");
  }
  ogrArgs.push("-spat_srs", "EPSG:4326", "-spat", String(xmin), String(ymin), String(xmax), String(ymax));
}

if (args.where) {
  ogrArgs.push("-where", args.where);
}

if (args.layer) {
  ogrArgs.push(args.layer);
}

console.log(`Converting parcels to ${output}`);
const result = spawnSync("ogr2ogr", ogrArgs, { stdio: "inherit" });
if (result.status !== 0) {
  fail("ogr2ogr failed. Try adding --layer with the layer name from `ogrinfo your-file.gpkg`.");
}

const metadata = {
  sourceName: args.sourceName || sourceInfo.title || basename(downloaded),
  sourceUrl: sourceInfo.url || args.source || "",
  periodOfContent: args.periodOfContent || sourceInfo.periodOfContent || "unknown",
  generatedAt: new Date().toISOString(),
  notes: args.notes || sourceInfo.notes || "",
};

writeFileSync(metadataOutput, `${JSON.stringify(metadata, null, 2)}\n`);
console.log(`Wrote ${metadataOutput}`);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/refresh-parcels.mjs --county "Rice County"
  node scripts/refresh-parcels.mjs --source /path/to/pine-parcels.zip --periodOfContent 2026-07-01
  node scripts/refresh-parcels.mjs --source /path/to/export.gpkg --bbox -92.80,46.08,-92.70,46.16

Options:
  --county             County name to search in Minnesota Geospatial Commons.
  --dataset            Exact CKAN dataset name, such as us-mn-co-rice-plan-parcels.
  --source             Local .gpkg/.shp/.zip file or direct URL.
  --layer              Optional OGR layer name.
  --bbox               Optional minLon,minLat,maxLon,maxLat clip for a smaller mobile file.
  --where              Optional OGR SQL filter, for example "OWNER_NAME LIKE '%SMITH%'".
  --output             GeoJSON output path. Defaults to data/parcels.geojson.
  --metadata           Metadata output path. Defaults to data/metadata.json.
  --periodOfContent    Data freshness date when using a local/manual source.
  --sourceName         Human-readable source name when using a local/manual source.
`);
}

async function sourceFromArgument(source) {
  if (/^https?:\/\//i.test(source)) {
    return { url: source, title: basename(new URL(source).pathname) };
  }
  const path = resolve(source);
  if (!existsSync(path)) fail(`Source file not found: ${path}`);
  return { path, title: basename(path) };
}

async function sourceFromGeocommons(options) {
  const packageData = options.dataset
    ? await fetchJson(`https://gisdata.mn.gov/api/3/action/package_show?id=${encodeURIComponent(options.dataset)}`)
    : await fetchJson(
        `https://gisdata.mn.gov/api/3/action/package_search?q=${encodeURIComponent(`${options.county} parcels`)}&rows=25`,
      );

  const record = options.dataset
    ? packageData.result
    : packageData.result.results.find((item) => {
        const haystack = `${item.title} ${item.name} ${(item.tags || []).map((tag) => tag.name).join(" ")}`.toLowerCase();
        return haystack.includes(options.county.toLowerCase().replace(/\s+county$/, "")) && haystack.includes("parcel");
      });

  if (!record) {
    fail(`No Minnesota Geospatial Commons parcel dataset found for ${options.county}. Try --source with a county export.`);
  }

  const resource =
    record.resources.find((item) => String(item.format).toLowerCase() === "gpkg") ||
    record.resources.find((item) => String(item.format).toLowerCase() === "shp") ||
    record.resources.find((item) => String(item.url).match(/\.(gpkg|zip)$/i));

  if (!resource) fail(`No GeoPackage or Shapefile resource found for ${record.title}`);

  const extras = Object.fromEntries((record.extras || []).map((item) => [item.key, item.value]));
  return {
    title: record.title,
    url: resource.url,
    periodOfContent: extras.dsPeriodOfContent,
    notes: `${record.notes || ""} ${extras.dsCurrentRef || ""}`.trim(),
  };
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) fail(`Request failed: ${url} (${response.status})`);
  return response.json();
}

async function ensureLocalFile(source, destinationDir) {
  if (!source) fail("No source URL or path found.");
  if (!/^https?:\/\//i.test(source)) return resolve(source);

  const destination = join(destinationDir, basename(new URL(source).pathname) || "download.dat");
  console.log(`Downloading ${source}`);
  const response = await fetch(source);
  if (!response.ok) fail(`Download failed: ${response.status} ${response.statusText}`);
  await pipeline(response.body, createWriteStream(destination));
  return destination;
}

function prepareDataset(filePath) {
  const extension = extname(filePath).toLowerCase();
  if (extension !== ".zip") return filePath;

  const destination = mkdtempSync(join(tmpdir(), "parcel-refresh-"));
  const unzip = spawnSync("unzip", ["-q", filePath, "-d", destination], { stdio: "inherit" });
  if (unzip.status !== 0) fail("Could not unzip parcel download.");

  const files = walk(destination);
  const gpkg = files.find((file) => file.toLowerCase().endsWith(".gpkg"));
  const shp = files.find((file) => file.toLowerCase().endsWith(".shp"));
  const dataset = gpkg || shp;
  if (!dataset) fail("Zip did not contain a .gpkg or .shp file.");
  return dataset;
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : fullPath;
  });
}

function assertCommand(command, message) {
  const check = spawnSync(command, ["--version"], { encoding: "utf8" });
  if (check.status !== 0) fail(message);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
