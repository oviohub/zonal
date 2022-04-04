# zonal: _beta version_
> Zonal Statistics

# purpose
This library calculates the intersections of two different geospatial datasets.
It helps answer questions like:
- what districts felt an earthquake?
- how much area experienced a tropical cyclone?
 

# install
```bash
npm install zonal
```

# usage
## vector with vector
If you want to compute zonal statistics using vector zones with vector classes:
```js
import { calculate } from "zonal";

const zones = { "type": "FeatureCollection": [...] }; 
const classes = { "type": "FeatureCollection": [...] }; 

const results = calculate({
  zones,
  zone_properties: ["ParishName"],
  classes,
  class_properties: ["wind_speed"],

  // modify zones in-place
  // adding aggregate statistics to
  // geojson feature properties
  preserve_features: true,
  
  // delimiter used when serializing classes
  // with multiple properties to strings
  class_properties_delimiter: ","

  // default is false
  // deletes zonal features that have no overlap with the classes
  // examples include districts not covered by a hurricane
  // or cities that can't feel an earthquake
  remove_features_with_no_overlap: true
});
```
result is the following object:
```js
{
  table: {
    columns: ["zone:ParishName", "class:wind_speed", "stat:area", "stat:percentage"],
    rows: [
      // ...
      {
        "zone:ParishName": "Concordia",
        "class:wind_speed": "90 km/h",
        "stat:area": 32134688,
        "stat:percentage": 0.01649868113083538
      },
      // ...
    ]
  },
  geojson: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          "zonal:zone_id": ["Acadia"],
          "zonal:stat:area": 1708349991,
          "zonal:stat:minority": "60 km/h",
          "zonal:stat:majority": "60 km/h",
          "zonal:stat:percentage": 1,
          "zonal:stat:sum": 1708349991,
          
          // zonal stats for each of the classes that overlap the zone
          "zonal:stat:classes": {
            "60 km/h": {
              area: 1708349991,
              percentage: 1
            },
            
            // null represents the area of the zone that doesn't intersect classes
            "null": {
              area: 0,
              percentage: 0
            }
          }          
        },
        geometry: { /* ... */ }
      },
      // ...
    ]
  }
  // ...
}
```
