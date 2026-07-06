# Emslander's Big Pine

A small static web app for seeing your phone's GPS location relative to parcel boundaries. It is designed for GitHub Pages, Android, and iPhone. There is no server and no paid map key.

## Current Status

The app now includes an approximate boundary for Pine County parcel `270280002`, the parcel found for `65770 Big Pine Rd, Finlayson, MN 55735`.

That boundary was manually digitized from the public Pine County Beacon map render because Pine County does not publish a clean free parcel download in the same way some Minnesota counties do. It is useful for family orientation on a phone, but it is not survey-grade. See `PINE_COUNTY_DATA_REQUEST.md` for the exact data request to replace it with an official GIS export.

## What Works After Parcel Data Is Loaded

- Opens directly to a map and asks for location permission.
- Tracks your current location with an accuracy circle.
- Shows parcel lines from `data/parcels.geojson`.
- Shows parcel labels when zoomed in. The included Pine County parcel is labeled `Emslander's Big Pine`.
- Keeps data freshness in `data/metadata.json` for maintenance, but does not show it in the family-facing map UI.
- Lets you tap a parcel for owner, parcel id, address, acres, and a Pine County Beacon link.

Important: parcel GIS data is approximate and should not be treated as a survey boundary.

## Deploy To GitHub Pages

1. Create a GitHub repo and commit these files.
2. In GitHub, go to Settings -> Pages.
3. Set the source to your default branch and the root folder.
4. Open the published `https://your-user.github.io/your-repo/` URL on the phones.

GPS in mobile browsers requires HTTPS, so GitHub Pages is a good fit.

## Add Your Parcel Data

The app expects:

- `data/parcels.geojson`
- `data/metadata.json`

Owner labels work best when the parcel properties include one of these fields: `owner`, `owner_name`, `OWNER_NAME`, `OWNERNAME`, `OWNER`, `taxpayer`, `TAXPAYER`, or `NAME`.

Parcel ids work best with one of: `pin`, `PIN`, `parcel_id`, `PARCEL_ID`, `parcelid`, `PARCELID`, `pid`, or `PID`.

The current `data/parcels.geojson` contains only parcel `270280002`. To avoid giving your family a false sense of precision, keep the `boundary_note` property unless you replace the geometry with an official GIS export.

## Fresh Data Process

Install GDAL once:

```bash
brew install gdal
```

For Minnesota counties that publish parcel data to Minnesota Geospatial Commons:

```bash
node scripts/refresh-parcels.mjs --county "Rice County"
```

To keep the mobile file small, clip to the few-mile area around the lake property:

```bash
node scripts/refresh-parcels.mjs --county "Rice County" --bbox -92.80,46.08,-92.70,46.16
```

For Pine County specifically, the official county website links public property information to Beacon/Schneider rather than a Geospatial Commons parcel download. Beacon's public map has `ExtractMapData` disabled, so the app needs an export from the county or a licensed data provider. Use one of these Pine County paths:

1. Ask Pine County Assessor for a parcel polygon export for your lake area, preferably GeoPackage, Shapefile, or GeoJSON. See `PINE_COUNTY_DATA_REQUEST.md`.
2. If Beacon provides an export to you, save it locally.
3. Run:

```bash
node scripts/refresh-parcels.mjs --source /path/to/pine-parcels.zip --sourceName "Pine County parcel export" --periodOfContent 2026-07-01
```

Then commit the updated `data/parcels.geojson` and `data/metadata.json`.

If you only need to update this one parcel before the county sends an export, the current fallback process is:

1. Open Pine County Beacon and search for parcel `270280002`.
2. Use the map render for that selected parcel as a reference image.
3. Digitize the visible parcel outline into `data/parcels.geojson`.
4. Set `data/metadata.json` to the Beacon report's visible "Last Data Upload" value and note that the boundary was digitized.

This fallback avoids paid services, but the geometry is only as accurate as the visible Beacon map render and the manual tracing.

## Highlight Your Family Property

Edit `data/settings.json`:

```json
{
  "homeParcelIds": ["YOUR-PARCEL-ID"],
  "homeOwnerKeywords": ["YOUR LAST NAME OR TRUST NAME"]
}
```

Matching parcels are drawn in amber.

## Free Vs Paid Data Options

Free:

- OpenStreetMap basemap tiles are free for light family use.
- Minnesota Geospatial Commons parcel files are free when a county publishes them.
- Pine County's official property records link is public, but Beacon is not a dependable embeddable data API for a static app.

Paid or semi-paid:

- Regrid, ReportAll, and similar parcel APIs can provide parcel boundaries and owner labels with better national coverage and easier refreshes. Expect API pricing to vary by usage and coverage; check current quotes before committing.
- A paid map tile provider can improve reliability if your app ever gets broader use than one family.

## Notes For Minnesota-Wide Use

The app already works with any Minnesota county parcel GeoJSON. The hard part is data availability: Minnesota does not appear to provide one complete, current, free statewide parcel layer with owner names. Many counties publish through Minnesota Geospatial Commons; some use county portals or vendors. The refresh script is intentionally county-by-county so the source and freshness stay documented.
