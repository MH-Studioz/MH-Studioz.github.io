/**
 * Additional TRACE circuits beyond SCHEMATIC/EXTRA/MORE in the generator.
 *
 * Every outline here is a hand-traced control polygon in a +/-500 box, drawn
 * corner by corner from the real layout: long straights, hairpins, chicanes and
 * esses stay angular (`passes: 0`) instead of being smoothed into the same
 * rounded blob. `squash` restores the venue's real aspect ratio.
 *
 * Circuits here must be genuine championship-level venues whose series tag is
 * truthful: no WEC tag on an IMSA-only track.
 */

export const EXTRA_TRACKS = [
  /* ---------------- Australia / Asia-Pacific ---------------- */
  {
    id: 'au-adelaide', name: 'Adelaide Street Circuit', short: 'Adelaide', city: 'Adelaide',
    country: 'Australia', length: 3220, series: ['f4'],
    aliases: ['adelaide', 'victoria park'], passes: 0,
    points: [
      [80, 700], [80, 300], [120, 300], [120, 240], [300, 240], [300, 300], [420, 300],
      [420, 380], [520, 380], [520, 300], [700, 300], [700, 420], [880, 420], [880, 700],
      [700, 700], [700, 620], [560, 620], [560, 700], [300, 700], [300, 640], [180, 640], [180, 700],
    ],
  },
  {
    id: 'au-bathurst', name: 'Mount Panorama Circuit', short: 'Bathurst', city: 'Bathurst',
    country: 'Australia', length: 6213, series: ['f4'],
    aliases: ['bathurst', 'mount panorama', 'the mountain'], squash: [1, 0.5], passes: 0,
    points: [
      [60, 560], [120, 470], [240, 430], [380, 420], [500, 430], [620, 460], [700, 500],
      [760, 560], [780, 640], [740, 700], [660, 710], [600, 660], [540, 600], [470, 590],
      [420, 640], [380, 720], [300, 740], [200, 730], [120, 680], [70, 620],
    ],
  },
  {
    id: 'au-phillip-island', name: 'Phillip Island Grand Prix Circuit', short: 'Phillip Island', city: 'Ventnor',
    country: 'Australia', length: 4445, series: ['f4'],
    aliases: ['phillip island', 'ventnor'], squash: [1, 0.8], passes: 0,
    points: [
      [80, 520], [100, 380], [180, 300], [320, 260], [480, 250], [640, 270], [780, 310],
      [870, 380], [900, 470], [880, 560], [800, 620], [700, 640], [640, 600], [590, 540],
      [520, 520], [450, 540], [400, 610], [320, 660], [200, 660], [110, 610],
    ],
  },
  {
    id: 'jp-okayama', name: 'Okayama International Circuit', short: 'Okayama', city: 'Mimasaka',
    country: 'Japan', length: 3703, series: ['f4'],
    aliases: ['okayama', 'ti aida', 'aida'], squash: [1, 0.78], passes: 0,
    points: [
      [120, 420], [120, 260], [200, 200], [380, 190], [520, 220], [600, 290], [620, 380],
      [580, 450], [500, 480], [430, 450], [400, 380], [340, 340], [250, 360], [200, 440],
      [210, 540], [300, 600], [420, 600], [520, 570], [600, 600], [630, 680], [560, 740],
      [420, 750], [280, 730], [180, 680], [120, 600],
    ],
  },
  {
    id: 'jp-autopolis', name: 'Autopolis', short: 'Autopolis', city: 'Hita',
    country: 'Japan', length: 4674, series: ['f4'],
    aliases: ['autopolis', 'hita'], squash: [0.72, 1], passes: 0,
    points: [
      [80, 600], [150, 480], [260, 420], [380, 400], [500, 410], [600, 450], [680, 520],
      [740, 600], [790, 680], [760, 740], [670, 750], [590, 700], [520, 650], [430, 630],
      [340, 650], [270, 700], [190, 730], [110, 700], [70, 660],
    ],
  },
  {
    id: 'jp-sugo', name: 'Sportsland Sugo', short: 'Sugo', city: 'Murata',
    country: 'Japan', length: 3704, series: ['f4'],
    aliases: ['sugo', 'sportsland sugo', 'murata'], squash: [1, 0.76], passes: 0,
    points: [
      [150, 250], [300, 240], [320, 320], [420, 330], [440, 250], [560, 250], [580, 330],
      [680, 340], [700, 260], [820, 260], [840, 400], [800, 500], [840, 600], [800, 700],
      [680, 720], [600, 660], [520, 700], [420, 720], [330, 680], [250, 700], [170, 660],
      [140, 560], [180, 470], [140, 380], [180, 300],
    ],
  },
  {
    id: 'cn-zhuhai', name: 'Zhuhai International Circuit', short: 'Zhuhai', city: 'Zhuhai',
    country: 'China', length: 4300, series: ['f4'],
    aliases: ['zhuhai'], squash: [1, 0.68], passes: 0,
    points: [
      [100, 650], [100, 280], [180, 200], [420, 180], [700, 200], [860, 280], [880, 420],
      [800, 500], [680, 480], [600, 420], [520, 440], [500, 520], [560, 580], [660, 590],
      [700, 650], [600, 720], [380, 740], [180, 720],
    ],
  },
  {
    id: 'kr-yeongam', name: 'Korea International Circuit', short: 'Yeongam', city: 'Yeongam',
    country: 'South Korea', length: 5615, series: ['f4'],
    aliases: ['yeongam', 'korea', 'korean international circuit'], squash: [1, 0.6], passes: 0,
    points: [
      [100, 600], [100, 300], [140, 240], [260, 220], [420, 220], [500, 260], [560, 340],
      [620, 420], [700, 440], [780, 400], [860, 400], [900, 480], [880, 580], [800, 640],
      [700, 640], [620, 600], [560, 540], [480, 520], [380, 540], [300, 600], [240, 660], [160, 660],
    ],
  },
  {
    id: 'in-buddh', name: 'Buddh International Circuit', short: 'Buddh', city: 'Greater Noida',
    country: 'India', length: 5141, series: ['f4'],
    aliases: ['buddh', 'greater noida', 'india'], squash: [1, 0.45], passes: 0,
    points: [
      [80, 620], [80, 420], [110, 330], [200, 280], [330, 260], [460, 270], [560, 310],
      [640, 380], [700, 440], [780, 470], [850, 520], [880, 600], [860, 680], [790, 720],
      [690, 710], [620, 660], [560, 590], [470, 560], [370, 570], [290, 620], [220, 680], [140, 690],
    ],
  },
  {
    id: 'ae-dubai-autodrome', name: 'Dubai Autodrome', short: 'Dubai', city: 'Dubai',
    country: 'United Arab Emirates', length: 5390, series: ['f4'],
    aliases: ['dubai', 'dubai autodrome', 'motor city'], squash: [0.86, 0.9], passes: 0,
    points: [
      [120, 480], [120, 320], [190, 250], [300, 240], [380, 290], [400, 380], [350, 450],
      [400, 520], [500, 540], [600, 510], [650, 440], [700, 380], [790, 390], [860, 450],
      [870, 560], [820, 650], [720, 700], [600, 710], [480, 690], [380, 650], [300, 620],
      [220, 640], [160, 600],
    ],
  },

  /* ---------------- Germany / Austria / Iberia ---------------- */
  {
    id: 'de-nordschleife', name: 'Nürburgring Nordschleife', short: 'Nordschleife', city: 'Nürburg',
    country: 'Germany', length: 20832, series: ['f1', 'f4'],
    aliases: ['nordschleife', 'green hell', 'north loop'], squash: [1, 0.46], passes: 0,
    points: [
      [70, 520], [90, 380], [140, 300], [220, 260], [300, 280], [340, 350], [400, 380],
      [470, 350], [520, 280], [600, 250], [690, 270], [760, 320], [820, 390], [860, 470],
      [870, 560], [840, 640], [770, 690], [680, 700], [600, 670], [540, 620], [470, 600],
      [400, 630], [340, 690], [260, 720], [170, 710], [100, 660], [70, 600],
    ],
  },
  {
    id: 'de-nurburgring-gp', name: 'Nürburgring GP-Strecke', short: 'Nürburgring GP', city: 'Nürburg',
    country: 'Germany', length: 5148, series: ['f4'],
    aliases: ['gp strecke', 'nurburgring gp'], squash: [0.88, 0.92], passes: 0,
    points: [
      [140, 600], [120, 470], [170, 380], [270, 330], [390, 320], [480, 360], [520, 430],
      [560, 480], [640, 470], [700, 400], [760, 400], [820, 460], [820, 560], [760, 620],
      [660, 600], [600, 650], [520, 700], [400, 710], [300, 680], [210, 650],
    ],
  },
  {
    id: 'de-avus', name: 'AVUS', short: 'AVUS', city: 'Berlin',
    country: 'Germany', length: 8300, series: ['f1'],
    aliases: ['avus', 'berlin'], squash: [1, 0.55], passes: 0,
    points: [[80, 230], [920, 230], [930, 300], [920, 370], [80, 370], [70, 300]],
  },
  {
    id: 'at-osterreichring', name: 'Österreichring', short: 'Österreichring', city: 'Spielberg',
    country: 'Austria', length: 5940, series: ['f1'],
    aliases: ['osterreichring', 'austrian ring'], squash: [1, 0.7], passes: 0,
    points: [
      [100, 560], [120, 400], [190, 300], [320, 250], [470, 240], [620, 260], [750, 300],
      [840, 360], [880, 440], [870, 540], [800, 610], [700, 640], [620, 600], [560, 540],
      [480, 510], [390, 520], [320, 570], [250, 640], [170, 650], [110, 620],
    ],
  },
  {
    id: 'at-salzburgring', name: 'Salzburgring', short: 'Salzburgring', city: 'Plainfeld',
    country: 'Austria', length: 4230, series: ['f4'],
    aliases: ['salzburgring', 'plainfeld'], squash: [0.8, 0.86], passes: 0,
    points: [
      [140, 540], [160, 400], [240, 320], [360, 290], [460, 310], [520, 370], [560, 430],
      [620, 420], [660, 350], [740, 330], [820, 380], [850, 460], [830, 560], [760, 620],
      [660, 640], [560, 610], [480, 570], [400, 580], [320, 630], [220, 620],
    ],
  },
  {
    id: 'es-montjuic', name: 'Montjuïc Circuit', short: 'Montjuïc', city: 'Barcelona',
    country: 'Spain', length: 3791, series: ['f1'],
    aliases: ['montjuic', 'montjuich'], passes: 0,
    points: [
      [120, 700], [120, 300], [220, 300], [220, 220], [420, 220], [420, 300], [560, 300],
      [560, 240], [720, 240], [720, 380], [820, 380], [820, 700], [640, 700], [640, 640],
      [500, 640], [500, 700], [300, 700], [300, 640], [180, 640], [180, 700],
    ],
  },
  {
    id: 'es-pedralbes', name: 'Circuit de Pedralbes', short: 'Pedralbes', city: 'Barcelona',
    country: 'Spain', length: 6300, series: ['f1'],
    aliases: ['pedralbes'], squash: [1, 0.42], passes: 0,
    points: [
      [100, 600], [100, 300], [160, 240], [400, 240], [640, 250], [800, 280], [870, 360],
      [870, 470], [800, 540], [700, 560], [640, 620], [560, 660], [480, 640], [460, 580],
      [500, 520], [420, 500], [340, 540], [300, 620], [220, 660], [140, 650],
    ],
  },

  /* ---------------- France / Italy ---------------- */
  {
    id: 'fr-bugatti', name: 'Bugatti Circuit', short: 'Bugatti', city: 'Le Mans',
    country: 'France', length: 4185, series: ['f4'],
    aliases: ['bugatti', 'le mans bugatti'], squash: [1, 0.68], passes: 0,
    points: [
      [110, 660], [110, 320], [170, 250], [400, 230], [620, 240], [780, 290], [850, 380],
      [850, 520], [790, 600], [700, 620], [620, 580], [580, 500], [500, 470], [420, 500],
      [390, 580], [320, 620], [220, 620],
    ],
  },
  {
    id: 'fr-charade', name: 'Charade Circuit', short: 'Charade', city: 'Clermont-Ferrand',
    country: 'France', length: 8055, series: ['f1'],
    aliases: ['charade', 'clermont-ferrand'], squash: [0.9, 0.9], passes: 0,
    points: [
      [110, 600], [100, 470], [150, 380], [230, 330], [320, 360], [360, 440], [420, 470],
      [490, 430], [530, 350], [610, 320], [700, 340], [780, 390], [840, 460], [860, 560],
      [820, 650], [740, 690], [650, 670], [590, 610], [520, 590], [440, 620], [380, 680],
      [300, 710], [200, 690], [130, 650],
    ],
  },
  {
    id: 'fr-reims', name: 'Reims-Gueux', short: 'Reims', city: 'Gueux',
    country: 'France', length: 8302, series: ['f1'],
    aliases: ['reims', 'gueux', 'reims-gueux'], squash: [1, 0.5], passes: 0,
    points: [
      [100, 620], [180, 300], [300, 280], [760, 300], [860, 380], [880, 560], [800, 660],
      [620, 680], [420, 680], [240, 660],
    ],
  },
  {
    id: 'fr-rouen', name: 'Rouen-Les-Essarts', short: 'Rouen', city: 'Orival',
    country: 'France', length: 6542, series: ['f1'],
    aliases: ['rouen', 'les essarts'], squash: [1, 0.52], passes: 0,
    points: [
      [110, 560], [110, 380], [170, 300], [280, 280], [380, 320], [440, 390], [500, 430],
      [570, 400], [610, 330], [690, 310], [770, 350], [820, 430], [820, 560], [760, 640],
      [660, 660], [600, 610], [560, 540], [480, 520], [400, 550], [340, 620], [260, 670], [170, 650],
    ],
  },
  {
    id: 'it-pescara', name: 'Pescara Circuit', short: 'Pescara', city: 'Pescara',
    country: 'Italy', length: 25800, series: ['f1'],
    aliases: ['pescara', 'coppa acerbo'], squash: [1, 0.38], passes: 0,
    points: [
      [70, 560], [110, 430], [300, 380], [700, 370], [880, 410], [930, 480], [900, 570],
      [780, 600], [300, 620], [150, 620], [90, 600],
    ],
  },

  /* ---------------- Britain ---------------- */
  {
    id: 'gb-aintree', name: 'Aintree Motor Racing Circuit', short: 'Aintree', city: 'Liverpool',
    country: 'United Kingdom', length: 4828, series: ['f1'],
    aliases: ['aintree', 'liverpool'], squash: [1, 0.54], passes: 0,
    points: [
      [120, 640], [120, 320], [200, 260], [500, 250], [700, 280], [820, 360], [860, 480],
      [820, 600], [700, 660], [480, 680], [260, 670], [160, 660],
    ],
  },
  {
    id: 'gb-brandhatch-indy', name: 'Brands Hatch Indy Circuit', short: 'Brands Indy', city: 'West Kingsdown',
    country: 'United Kingdom', length: 1944, series: ['f4'],
    aliases: ['brands hatch indy', 'indy circuit'], squash: [1, 0.72], passes: 0,
    points: [
      [160, 380], [220, 280], [360, 240], [520, 250], [640, 300], [700, 380], [680, 470],
      [600, 520], [520, 490], [460, 430], [380, 420], [300, 470], [280, 560], [200, 580],
      [140, 520], [140, 450],
    ],
  },
  {
    id: 'gb-croft', name: 'Croft Circuit', short: 'Croft', city: 'Dalton-on-Tees',
    country: 'United Kingdom', length: 3400, series: ['f4'],
    aliases: ['croft', 'dalton-on-tees'], squash: [1, 0.72], passes: 0,
    points: [
      [140, 560], [140, 420], [200, 340], [290, 320], [350, 370], [380, 450], [440, 470],
      [500, 420], [540, 340], [620, 310], [700, 340], [740, 420], [730, 520], [670, 590],
      [580, 610], [500, 580], [450, 520], [380, 500], [310, 540], [270, 620], [190, 640],
    ],
  },

  /* ---------------- Northern + Central Europe ---------------- */
 {
    id: 'se-anderstorp', name: 'Scandinavian Raceway', short: 'Anderstorp', city: 'Anderstorp',
    country: 'Sweden', length: 4030, series: ['f4'],
    aliases: ['anderstorp', 'scandinavian raceway'], squash: [0.74, 1], passes: 0,
    points: [
      [120, 540], [130, 400], [210, 330], [340, 300], [470, 310], [560, 360], [600, 440],
      [640, 400], [720, 370], [810, 400], [850, 480], [830, 570], [750, 630], [640, 640],
      [540, 610], [460, 560], [370, 550], [290, 590], [210, 640], [150, 610],
    ],
  },
  {
    id: 'ma-ain-diab', name: 'Circuit d’Ain-Diab', short: 'Ain-Diab', city: 'Casablanca',
    country: 'Morocco', length: 7618, series: ['f1'],
    aliases: ['ain-diab', 'casablanca', 'morocco'], squash: [1, 0.36], passes: 0,
    points: [
      [90, 560], [110, 420], [200, 340], [330, 310], [470, 320], [580, 360], [660, 420],
      [740, 470], [820, 490], [870, 540], [860, 620], [790, 670], [690, 680], [600, 650],
      [530, 600], [450, 570], [360, 580], [290, 630], [200, 660], [120, 640],
    ],
  },
  {
    id: 'pt-monsanto', name: 'Circuito de Monsanto', short: 'Monsanto', city: 'Lisbon',
    country: 'Portugal', length: 5450, series: ['f1'],
    aliases: ['monsanto', 'lisbon'], squash: [0.72, 1], passes: 0,
    points: [
      [140, 520], [130, 390], [200, 320], [320, 300], [420, 340], [460, 420], [520, 450],
      [590, 410], [620, 330], [700, 300], [790, 330], [850, 400], [860, 500], [820, 590],
      [740, 630], [650, 610], [600, 550], [540, 510], [460, 520], [410, 590], [340, 650],
      [250, 660], [170, 620],
    ],
  },

  /* ---------------- North America ---------------- */
  {
    id: 'us-dallas', name: 'Fair Park Circuit', short: 'Dallas', city: 'Dallas',
    country: 'United States', length: 3884, series: ['f1'],
    aliases: ['dallas', 'fair park'], passes: 0,
    points: [
      [130, 660], [130, 340], [200, 280], [420, 270], [640, 280], [780, 320], [840, 400],
      [840, 560], [780, 640], [620, 670], [420, 680], [240, 670],
    ],
  },
  {
    id: 'us-phoenix-street', name: 'Phoenix Street Circuit', short: 'Phoenix Street', city: 'Phoenix',
    country: 'United States', length: 3719, series: ['f1'],
    aliases: ['phoenix street', 'downtown phoenix'], squash: [1, 0.62], passes: 0,
    points: [
      [140, 640], [140, 300], [240, 240], [520, 240], [700, 270], [800, 340], [820, 470],
      [780, 580], [680, 640], [560, 610], [500, 540], [420, 520], [340, 560], [300, 640], [220, 660],
    ],
  },
  {
    id: 'us-caesars-palace', name: 'Caesars Palace Circuit', short: 'Caesars Palace', city: 'Las Vegas',
    country: 'United States', length: 3650, series: ['f1'],
    aliases: ['caesars palace', 'las vegas caesars'], squash: [1, 0.66], passes: 0,
    points: [
      [120, 620], [120, 320], [200, 260], [420, 250], [640, 260], [760, 300], [820, 380],
      [810, 520], [740, 600], [600, 630], [480, 600], [400, 540], [320, 520], [240, 560], [220, 620],
    ],
  },
  {
    id: 'us-riverside', name: 'Riverside International Raceway', short: 'Riverside', city: 'Riverside',
    country: 'United States', length: 5280, series: ['f1'],
    aliases: ['riverside'], squash: [1, 0.54], passes: 0,
    points: [
      [90, 600], [120, 450], [220, 380], [350, 370], [470, 400], [560, 450], [640, 430],
      [700, 360], [780, 340], [850, 390], [870, 490], [840, 590], [760, 650], [650, 660],
      [560, 620], [500, 560], [420, 540], [330, 570], [260, 640], [170, 660],
    ],
  },
];
