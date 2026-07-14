const DEFAULT_VIEW = {
  center: [46.119, -92.741],
  zoom: 16,
  locateZoom: 16,
  labelsMinZoom: 12,
};

const OWNER_FIELDS = [
  "owner",
  "owner_name",
  "OWNER_NAME",
  "OWNERNAME",
  "OWNER",
  "taxpayer",
  "TAXPAYER",
  "NAME",
];

const PIN_FIELDS = ["pin", "PIN", "parcel_id", "PARCEL_ID", "parcelid", "PARCELID", "pid", "PID"];
const ADDRESS_FIELDS = ["address", "ADDRESS", "situs", "SITUS", "site_address", "SITE_ADDRESS", "prop_addr", "PROP_ADDR"];
const LABEL_FIELDS = [...OWNER_FIELDS, "display_label", "label", ...PIN_FIELDS];

const state = {
  metadata: null,
  settings: null,
  parcelLayer: null,
  parcelFeatures: [],
  labelLayers: new Set(),
  userMarker: null,
  accuracyCircle: null,
  hasParcelData: false,
  locationState: "inactive",
  installPrompt: null,
};

const elements = {
  status: document.querySelector("#statusText"),
  locate: document.querySelector("#locateButton"),
  dialog: document.querySelector("#parcelDialog"),
  closeDialog: document.querySelector("#closeDialog"),
  parcelTitle: document.querySelector("#parcelTitle"),
  parcelDetails: document.querySelector("#parcelDetails"),
  propertyLink: document.querySelector("#propertyLink"),
  install: document.querySelector("#installButton"),
  installDialog: document.querySelector("#installDialog"),
  closeInstallDialog: document.querySelector("#closeInstallDialog"),
  installInstructions: document.querySelector("#installInstructions"),
};

if (window.lucide) {
  window.lucide.createIcons();
}

const map = L.map("map", {
  zoomControl: false,
  maxZoom: 20,
}).setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);

L.control.zoom({ position: "bottomright" }).addTo(map);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 20,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const parcelStyle = (feature) => {
  const isHome = isConfiguredHomeParcel(feature.properties || {});
  return {
    color: isHome ? "#f59e0b" : "#138a72",
    weight: isHome ? 3 : 1.4,
    opacity: 0.95,
    fillColor: isHome ? "#f59e0b" : "#10b981",
    fillOpacity: isHome ? 0.12 : 0.045,
  };
};

init();

async function init() {
  const [metadata, settings] = await Promise.all([loadJson("data/metadata.json", null), loadJson("data/settings.json", {})]);
  state.metadata = metadata;
  state.settings = settings || {};
  await loadParcels();
  wireControls();
  prepareInstall();
  registerServiceWorker();
  prepareLocation();
  updateLocateButton();
}

async function loadJson(url, fallback) {
  try {
    const response = await fetch(`${url}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } catch (error) {
    console.warn(`Could not load ${url}`, error);
    return fallback;
  }
}

async function loadParcels() {
  const geojson = await loadJson("data/parcels.geojson", null);
  if (!geojson || !Array.isArray(geojson.features) || geojson.features.length === 0) {
    state.hasParcelData = false;
    setStatus("GPS map is ready, but parcel boundaries are not loaded. For Pine County, request a parcel polygon export from the Assessor, then run the refresh script.");
    return false;
  }

  state.hasParcelData = true;
  state.parcelFeatures = geojson.features;
  state.parcelLayer = L.geoJSON(geojson, {
    style: parcelStyle,
    onEachFeature: (feature, layer) => {
      layer.on("click", (event) => {
        L.DomEvent.stopPropagation(event);
        showParcel(feature);
      });
      bindOwnerLabel(feature, layer);
    },
  }).addTo(map);

  const bounds = state.parcelLayer.getBounds();
  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [36, 36], maxZoom: DEFAULT_VIEW.zoom });
  }

  const count = geojson.features.length.toLocaleString();
  setStatus(`${count} parcel${geojson.features.length === 1 ? "" : "s"} loaded. Tap the crosshair to follow your location.`);
  refreshLabels();
  return true;
}

function wireControls() {
  elements.locate.addEventListener("click", () => {
    if (state.locationState === "active" || state.locationState === "pending") {
      stopLocationTracking();
    } else {
      startLocationTracking();
    }
  });

  elements.closeDialog.addEventListener("click", () => elements.dialog.close());
  elements.install.addEventListener("click", showInstallPrompt);
  elements.closeInstallDialog.addEventListener("click", () => elements.installDialog.close());
  map.on("zoomend", refreshLabels);
  map.on("click", openTappedParcel);
}

function prepareInstall() {
  if (isStandalone()) return;
  elements.install.hidden = false;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
  });

  window.addEventListener("appinstalled", () => {
    state.installPrompt = null;
    elements.install.hidden = true;
  });

  if (isIos()) elements.install.hidden = false;
}

async function showInstallPrompt() {
  if (state.installPrompt) {
    const prompt = state.installPrompt;
    state.installPrompt = null;
    elements.install.hidden = true;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome !== "accepted") elements.install.hidden = false;
    return;
  }

  elements.installInstructions.textContent = isIos()
    ? "In Safari, tap the Share button, then choose Add to Home Screen."
    : "Open your browser menu, then choose Install app or Add to Home screen.";
  if (typeof elements.installDialog.showModal === "function") elements.installDialog.showModal();
}

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js?v=20260713-1").catch((error) => console.warn("Service worker registration failed", error));
  }
}

function prepareLocation() {
  if (!navigator.geolocation) {
    setStatus("Location is not available in this browser.");
    elements.locate.disabled = true;
    return;
  }
  map.on("locationfound", onLocationFound);
  map.on("locationerror", (error) => {
    if (state.locationState === "inactive") return;
    state.locationState = "inactive";
    map.stopLocate();
    updateLocateButton();
    const fallback = state.hasParcelData
      ? "Location permission is needed to show where you are."
      : "Location permission is needed, and parcel boundaries are still not loaded.";
    setStatus(error.message || fallback);
  });
}

function startLocationTracking() {
  state.locationState = "pending";
  updateLocateButton();
  setStatus("Requesting location...");
  map.locate({ enableHighAccuracy: true, watch: true, maximumAge: 4000, timeout: 15000 });
}

function stopLocationTracking() {
  state.locationState = "inactive";
  map.stopLocate();
  updateLocateButton();
  setStatus("Location updates paused. Tap the crosshair to follow again.");
}

function updateLocateButton() {
  const isActive = state.locationState === "active";
  const isPending = state.locationState === "pending";
  elements.locate.classList.toggle("is-tracking", isActive);
  elements.locate.classList.toggle("is-pending", isPending);
  elements.locate.setAttribute("aria-pressed", String(isActive));
  const label = isActive || isPending ? "Stop following my location" : "Follow my location";
  elements.locate.setAttribute("aria-label", label);
  elements.locate.setAttribute("title", label);
}

function onLocationFound(event) {
  if (state.locationState === "inactive") return;
  state.locationState = "active";
  updateLocateButton();
  const latLng = event.latlng;
  if (!state.userMarker) {
    state.userMarker = L.marker(latLng, {
      icon: L.divIcon({
        className: "",
        html: '<div class="user-dot"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      }),
      interactive: false,
      zIndexOffset: 1000,
    }).addTo(map);

    state.accuracyCircle = L.circle(latLng, {
      radius: event.accuracy || 0,
      color: "#2563eb",
      weight: 1,
      opacity: 0.45,
      fillOpacity: 0.08,
    }).addTo(map);
  } else {
    state.userMarker.setLatLng(latLng);
    state.accuracyCircle.setLatLng(latLng).setRadius(event.accuracy || 0);
  }

  map.setView(latLng, Math.max(map.getZoom(), DEFAULT_VIEW.locateZoom), { animate: true });

  const accuracy = event.accuracy ? `Accuracy about ${Math.round(event.accuracy)} m.` : "GPS location active.";
  const nextStep = state.hasParcelData ? "Tap a parcel for details." : "Parcel boundaries still need to be loaded from a county export.";
  setStatus(`${accuracy} ${nextStep}`);
}

function openTappedParcel(event) {
  if (!state.parcelFeatures.length) return;
  const feature = state.parcelFeatures.find((parcel) => containsLatLng(parcel.geometry, event.latlng));
  if (feature) showParcel(feature);
}

function containsLatLng(geometry, latlng) {
  if (!geometry) return false;
  if (geometry.type === "Polygon") {
    return polygonContainsLatLng(geometry.coordinates, latlng);
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon) => polygonContainsLatLng(polygon, latlng));
  }
  return false;
}

function polygonContainsLatLng(rings, latlng) {
  if (!Array.isArray(rings) || !rings.length) return false;
  const insideOuter = ringContainsLatLng(rings[0], latlng);
  if (!insideOuter) return false;
  return !rings.slice(1).some((hole) => ringContainsLatLng(hole, latlng));
}

function ringContainsLatLng(ring, latlng) {
  let inside = false;
  const x = latlng.lng;
  const y = latlng.lat;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function bindOwnerLabel(feature, layer) {
  const label = getFirstValue(feature.properties || {}, LABEL_FIELDS);
  if (!label) return;
  layer.bindTooltip(shorten(label, 34), {
    permanent: true,
    direction: "center",
    className: "owner-label",
    opacity: 1,
  });
  state.labelLayers.add(layer);
}

function refreshLabels() {
  const shouldShow = map.getZoom() >= DEFAULT_VIEW.labelsMinZoom;
  state.labelLayers.forEach((layer) => {
    if (shouldShow) {
      layer.openTooltip();
    } else {
      layer.closeTooltip();
    }
  });
}

function showParcel(feature) {
  const props = feature.properties || {};
  const owner = getFirstValue(props, OWNER_FIELDS) || "Owner unavailable";
  const pin = getFirstValue(props, PIN_FIELDS) || "Unknown";
  elements.parcelTitle.textContent = owner === "Owner unavailable" ? getFirstValue(props, LABEL_FIELDS) || owner : owner;
  elements.parcelDetails.innerHTML = "";

  const rows = [
    ["Parcel", pin],
    ["Acres", getFirstValue(props, ["acres", "ACRES", "acreage", "ACREAGE"]) || "Unknown"],
    ["Source", state.metadata?.sourceName || "Local parcel file"],
  ];
  const boundaryNote = getFirstValue(props, ["boundary_note", "BOUNDARY_NOTE"]);
  if (boundaryNote) rows.push(["Boundary note", boundaryNote]);

  rows.forEach(([label, value]) => {
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = value;
    elements.parcelDetails.append(term, detail);
  });

  const beaconUrl = new URL("https://beacon.schneidercorp.com/Application.aspx");
  beaconUrl.searchParams.set("AppID", "197");
  beaconUrl.searchParams.set("LayerID", "2640");
  beaconUrl.searchParams.set("PageID", "1488");
  beaconUrl.searchParams.set("PageTypeID", "2");
  if (pin !== "Unknown") beaconUrl.searchParams.set("KeyValue", pin);
  elements.propertyLink.href = beaconUrl.toString();

  if (typeof elements.dialog.showModal === "function") {
    if (elements.dialog.open) elements.dialog.close();
    elements.dialog.showModal();
  } else {
    alert(`${owner}\nParcel: ${pin}`);
  }
}

function isConfiguredHomeParcel(props) {
  const ids = state.settings?.homeParcelIds || [];
  const ownerKeywords = (state.settings?.homeOwnerKeywords || []).map((item) => String(item).toLowerCase());
  const pin = String(getFirstValue(props, PIN_FIELDS) || "").toLowerCase();
  const owner = String(getFirstValue(props, OWNER_FIELDS) || "").toLowerCase();
  return ids.some((id) => pin === String(id).toLowerCase()) || ownerKeywords.some((word) => owner.includes(word));
}

function getFirstValue(props, names) {
  for (const name of names) {
    const value = props[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function shorten(value, maxLength) {
  const text = String(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}...`;
}

function formatDate(value) {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function setStatus(message) {
  elements.status.textContent = message;
}
