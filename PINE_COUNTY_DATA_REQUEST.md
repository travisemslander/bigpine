# Pine County Parcel Data Request

The app needs one missing ingredient: a parcel polygon GIS export. Pine County's public website points property lookup to Beacon, and the Beacon public map does not allow public vector extraction. The practical next step is to ask Pine County for an export.

## Contact

Pine County Assessor  
Email: assessors@pinecountymn.gov  
Phone: 320-591-1632  
Website: https://www.pinecountymn.gov/departments/assessor/index.php

## Ask For This

Request a GIS parcel polygon export for your lake-property area, or the whole county if they prefer.

Preferred format:

- GeoPackage (`.gpkg`) first choice
- Shapefile zip (`.zip`) second choice
- GeoJSON (`.geojson`) also works

Preferred coordinate system:

- EPSG:4326 / WGS84 if they can provide it
- Native Pine County coordinate system is also fine; the refresh script can convert it with GDAL

Useful fields:

- Parcel ID / PIN
- Owner name, if public/releasable
- Situs/property address
- Acreage
- Data current date or metadata date

Also ask whether you are allowed to publish the resulting map on a public GitHub Pages URL. If owner names are included, consider keeping the repo/site private or removing owner names before publishing.

## Copy/Paste Email

Subject: Parcel GIS export request for family property map

Hello Pine County Assessor team,

My family recently purchased lake property in Pine County and we are trying to better understand our property boundaries while walking the land. We would like to make a simple private/family web map that shows our phone GPS location relative to parcel boundaries.

Could you provide a GIS export of parcel polygon boundaries for the area around our property, or the full county if that is easier? GeoPackage, zipped Shapefile, or GeoJSON would all work.

If available and releasable, these attributes would be helpful:

- Parcel ID / PIN
- Owner name
- Situs/property address
- Acreage
- Data current date or metadata date

If owner names cannot be released in an export, parcel boundaries and parcel IDs would still be useful.

Could you also let me know whether this data may be used in a family web map hosted on GitHub Pages, and whether it needs to remain private?

Thank you.

## After You Receive The File

Put the county file somewhere on your computer, then from this project run:

```bash
node scripts/refresh-parcels.mjs --source /path/to/pine-parcels.zip --sourceName "Pine County parcel export" --periodOfContent YYYY-MM-DD
```

If they send a full-county file, clip it to the lake area so phones load it quickly:

```bash
node scripts/refresh-parcels.mjs --source /path/to/pine-parcels.zip --bbox -92.80,46.08,-92.70,46.16 --sourceName "Pine County parcel export" --periodOfContent YYYY-MM-DD
```

Then commit:

- `data/parcels.geojson`
- `data/metadata.json`

## If Pine County Cannot Provide It

The fallback is a paid parcel provider such as Regrid or ReportAll. Those services exist specifically to provide parcel boundaries and owner attributes through downloads/APIs. They are usually the easiest technical path, but you would need to check current pricing and license terms before using them.
