# zonal
Zonal Statistics

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
  zone_properties,
  classes,
  class_properties,

  // modify zones in-place
  // adding aggregate statistics to
  // geojson feature properties
  preserve_features: true
});
```
result is the following object:
```js
{
  table: [
    // ...
    {
      "zone:ParishName": "Concordia",
      "class:wind_speed": "90 km/h",
      "stat:area": 32134688,
      "stat:percentage": 0.01649868113083538
    },
    // ...
  ],
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
