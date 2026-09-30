// Harbours shaped by hand around each port, at a larger scale than the 1:60 chart so a town, its anchorage and
// its forts fit (Havana's bay is only ~70 m across at chart scale). `anchor`: [lon, lat]; shapes are in metres
// from the anchor, x east and z south (north is -z). water: polygons cut from the island (applied first);
// land: polygons unioned with it; hills: [x, z, radius, height] added to the island's relief.
export const HARBOURS = [
  {
    // Nassau: a strip of beach under a low ridge, the harbour sheltered by the long, low Hog Island
    id: 'nassau', island: 'newprovidence', anchor: [-77.345, 25.078],
    water: [
      [[-340, -22], [-120, -14], [120, -16], [340, -24], [380, -95], [-380, -95]], // the harbour (dredged a little for the game's galleons)
    ],
    land: [
      // Hog Island: 480 m of sand and scrub lying east-west off the town
      [[-150, -150], [-60, -166], [80, -170], [230, -164], [340, -150], [345, -138], [240, -128], [100, -124], [-40, -126], [-140, -134]],
    ],
    hills: [[-200, 150, 110, 12], [0, 165, 130, 16], [190, 150, 100, 11]], // the ridge behind Bay Street
  },
  {
    // La Habana: the narrow channel between the Morro and La Punta opening into a pocket bay; the walled
    // city on the peninsula west of the channel
    id: 'havana', island: 'cuba', anchor: [-82.357, 23.14],
    water: [
      // the entrance channel, running south-south-east from the sea
      [[-70, -75], [-30, -62], [8, -40], [62, -44], [82, -70], [110, -80], [100, -30], [90, 20], [104, 80], [130, 150], [20, 170], [0, 100], [-15, 30], [-30, -35]],
      // the bay with its three arms (Marimelena to the north-east, Guasabacoa east, Atarés south-west)
      [[-40, 150], [120, 120], [260, 60], [360, 90], [470, 180], [520, 330], [430, 420], [300, 470], [140, 560], [-30, 520], [-140, 440], [-160, 330], [-110, 230]],
    ],
    land: [
      // the Morro headland: a rocky bluff on the east side of the mouth
      [[88, -95], [130, -118], [190, -112], [235, -80], [230, -20], [190, 30], [110, 40], [92, -30]],
    ],
    hills: [[160, -70, 50, 18], [240, 250, 120, 14], [-380, 380, 160, 10]], // Morro, La Cabaña ridge, hills beyond the walls
  },
  {
    // Port Royal: the town packed onto the western tip of the Palisadoes sand spit, Fort Charles at the point,
    // Kingston Harbour behind it and the open Caribbean in front
    id: 'portroyal', island: 'jamaica', anchor: [-76.842, 17.937],
    water: [
      // Kingston Harbour (the town side)
      [[-760, -170], [-420, -230], [0, -250], [380, -200], [520, -60], [430, 110], [-100, 130], [-560, 130], [-800, 40]],
      // the Caribbean south of the spit
      [[-1000, 170], [700, 140], [700, 250], [-1000, 280]],
      // the channel west of the point
      [[-1000, -60], [-760, -60], [-760, 180], [-1000, 180]],
    ],
    land: [
      // the spit, running east to the mainland
      [[-420, 150], [0, 142], [400, 132], [720, 90], [760, 140], [420, 176], [0, 186], [-420, 196]],
      // the town on its western tip, and the point where Fort Charles stands
      [[-690, 105], [-560, 92], [-400, 100], [-360, 150], [-400, 215], [-560, 232], [-680, 225], [-730, 180], [-735, 140]],
    ],
  },
  {
    // Cayona (Basse-Terre): a little coastal plain on Tortuga's south shore under steep hills, with the
    // Fort de la Roche on its crag above the town
    id: 'tortuga', island: 'tortuga', anchor: [-72.78, 20.03],
    land: [
      [[-230, 20], [-120, 60], [0, 78], [130, 70], [230, 40], [220, 0], [-220, 0]],
    ],
    hills: [[-70, -20, 32, 16], [60, -60, 110, 26]],
  },
  {
    // the Canal de la Tortue: Hispaniola's facing shore cut back so the channel keeps its proportions next to
    // the enlarged island
    id: 'tortuga_channel', island: 'hispaniola', anchor: [-72.78, 20.03],
    water: [
      [[-900, 150], [-400, 170], [0, 190], [400, 180], [900, 150], [900, 290], [700, 320], [520, 300], [380, 335], [200, 318], [60, 345], [-80, 322], [-240, 338], [-420, 305], [-600, 326], [-760, 296], [-900, 305]],
    ],
  },
];
