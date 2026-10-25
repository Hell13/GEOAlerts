const fs = require('fs');
const path = require('path');

// Comprehensive ISO-3166-1 numeric -> ISO2, ISO3, Region, Capital/Centroid coordinates
const ISO_META = {
  "AF": { iso3: "AFG", num: "004", region: "Asia", lat: 33.9, lon: 67.7 },
  "AL": { iso3: "ALB", num: "008", region: "Europe", lat: 41.1, lon: 20.1 },
  "DZ": { iso3: "DZA", num: "012", region: "Africa", lat: 28.0, lon: 1.6 },
  "AD": { iso3: "AND", num: "020", region: "Europe", lat: 42.5, lon: 1.5 },
  "AO": { iso3: "AGO", num: "024", region: "Africa", lat: -11.2, lon: 17.8 },
  "AG": { iso3: "ATG", num: "028", region: "Americas", lat: 17.0, lon: -61.8 },
  "AR": { iso3: "ARG", num: "032", region: "Americas", lat: -38.4, lon: -63.6 },
  "AM": { iso3: "ARM", num: "051", region: "Asia", lat: 40.0, lon: 45.0 },
  "AU": { iso3: "AUS", num: "036", region: "Oceania", lat: -25.2, lon: 133.7 },
  "AT": { iso3: "AUT", num: "040", region: "Europe", lat: 47.5, lon: 14.5 },
  "AZ": { iso3: "AZE", num: "031", region: "Asia", lat: 40.1, lon: 47.5 },
  "BS": { iso3: "BHS", num: "044", region: "Americas", lat: 25.0, lon: -77.4 },
  "BH": { iso3: "BHR", num: "048", region: "Middle East", lat: 26.0, lon: 50.5 },
  "BD": { iso3: "BGD", num: "050", region: "Asia", lat: 23.6, lon: 90.3 },
  "BB": { iso3: "BRB", num: "052", region: "Americas", lat: 13.1, lon: -59.5 },
  "BY": { iso3: "BLR", num: "112", region: "Europe", lat: 53.7, lon: 27.9 },
  "BE": { iso3: "BEL", num: "056", region: "Europe", lat: 50.5, lon: 4.4 },
  "BZ": { iso3: "BLZ", num: "084", region: "Americas", lat: 17.1, lon: -88.4 },
  "BJ": { iso3: "BEN", num: "204", region: "Africa", lat: 9.3, lon: 2.3 },
  "BT": { iso3: "BTN", num: "064", region: "Asia", lat: 27.5, lon: 90.4 },
  "BO": { iso3: "BOL", num: "068", region: "Americas", lat: -16.2, lon: -63.5 },
  "BA": { iso3: "BIH", num: "070", region: "Europe", lat: 43.9, lon: 17.6 },
  "BW": { iso3: "BWA", num: "072", region: "Africa", lat: -22.3, lon: 24.6 },
  "BR": { iso3: "BRA", num: "076", region: "Americas", lat: -14.2, lon: -51.9 },
  "BN": { iso3: "BRN", num: "096", region: "Asia", lat: 4.5, lon: 114.7 },
  "BG": { iso3: "BGR", num: "100", region: "Europe", lat: 42.7, lon: 25.4 },
  "BF": { iso3: "BFA", num: "854", region: "Africa", lat: 12.2, lon: -1.5 },
  "BI": { iso3: "BDI", num: "108", region: "Africa", lat: -3.3, lon: 29.9 },
  "CV": { iso3: "CPV", num: "132", region: "Africa", lat: 16.0, lon: -24.0 },
  "KH": { iso3: "KHM", num: "116", region: "Asia", lat: 12.5, lon: 104.9 },
  "CM": { iso3: "CMR", num: "120", region: "Africa", lat: 7.3, lon: 12.3 },
  "CA": { iso3: "CAN", num: "124", region: "Americas", lat: 56.1, lon: -106.3 },
  "CF": { iso3: "CAF", num: "140", region: "Africa", lat: 6.6, lon: 20.9 },
  "TD": { iso3: "TCD", num: "148", region: "Africa", lat: 15.4, lon: 18.7 },
  "CL": { iso3: "CHL", num: "152", region: "Americas", lat: -35.6, lon: -71.5 },
  "CN": { iso3: "CHN", num: "156", region: "Asia", lat: 35.8, lon: 104.1 },
  "CO": { iso3: "COL", num: "170", region: "Americas", lat: 4.5, lon: -74.2 },
  "KM": { iso3: "COM", num: "174", region: "Africa", lat: -11.8, lon: 43.8 },
  "CG": { iso3: "COG", num: "178", region: "Africa", lat: -0.2, lon: 15.8 },
  "CD": { iso3: "COD", num: "180", region: "Africa", lat: -4.0, lon: 21.7 },
  "CR": { iso3: "CRI", num: "188", region: "Americas", lat: 9.7, lon: -83.7 },
  "CI": { iso3: "CIV", num: "384", region: "Africa", lat: 7.5, lon: -5.5 },
  "HR": { iso3: "HRV", num: "191", region: "Europe", lat: 45.1, lon: 15.2 },
  "CU": { iso3: "CUB", num: "192", region: "Americas", lat: 21.5, lon: -77.7 },
  "CY": { iso3: "CYP", num: "196", region: "Europe", lat: 35.1, lon: 33.4 },
  "CZ": { iso3: "CZE", num: "203", region: "Europe", lat: 49.8, lon: 15.4 },
  "DK": { iso3: "DNK", num: "208", region: "Europe", lat: 56.2, lon: 9.5 },
  "DJ": { iso3: "DJI", num: "262", region: "Africa", lat: 11.8, lon: 42.5 },
  "DM": { iso3: "DMA", num: "212", region: "Americas", lat: 15.4, lon: -61.3 },
  "DO": { iso3: "DOM", num: "214", region: "Americas", lat: 18.7, lon: -70.1 },
  "EC": { iso3: "ECU", num: "218", region: "Americas", lat: -1.8, lon: -78.1 },
  "EG": { iso3: "EGY", num: "818", region: "Middle East", lat: 26.8, lon: 30.8 },
  "SV": { iso3: "SLV", num: "222", region: "Americas", lat: 13.7, lon: -88.8 },
  "GQ": { iso3: "GNQ", num: "226", region: "Africa", lat: 1.6, lon: 10.2 },
  "ER": { iso3: "ERI", num: "232", region: "Africa", lat: 15.1, lon: 39.7 },
  "EE": { iso3: "EST", num: "233", region: "Europe", lat: 58.5, lon: 25.0 },
  "SZ": { iso3: "SWZ", num: "748", region: "Africa", lat: -26.5, lon: 31.4 },
  "ET": { iso3: "ETH", num: "231", region: "Africa", lat: 9.1, lon: 40.4 },
  "FJ": { iso3: "FJI", num: "242", region: "Oceania", lat: -17.7, lon: 178.0 },
  "FI": { iso3: "FIN", num: "246", region: "Europe", lat: 61.9, lon: 25.7 },
  "FR": { iso3: "FRA", num: "250", region: "Europe", lat: 46.2, lon: 2.2 },
  "GA": { iso3: "GAB", num: "266", region: "Africa", lat: -0.8, lon: 11.6 },
  "GM": { iso3: "GMB", num: "270", region: "Africa", lat: 13.4, lon: -15.3 },
  "GE": { iso3: "GEO", num: "268", region: "Asia", lat: 42.3, lon: 43.3 },
  "DE": { iso3: "DEU", num: "276", region: "Europe", lat: 51.1, lon: 10.4 },
  "GH": { iso3: "GHA", num: "288", region: "Africa", lat: 7.9, lon: -1.0 },
  "GR": { iso3: "GRC", num: "300", region: "Europe", lat: 39.0, lon: 21.8 },
  "GD": { iso3: "GRD", num: "308", region: "Americas", lat: 12.1, lon: -61.6 },
  "GT": { iso3: "GTM", num: "320", region: "Americas", lat: 15.7, lon: -90.2 },
  "GN": { iso3: "GIN", num: "324", region: "Africa", lat: 9.9, lon: -9.6 },
  "GW": { iso3: "GNB", num: "624", region: "Africa", lat: 11.8, lon: -15.1 },
  "GY": { iso3: "GUY", num: "328", region: "Americas", lat: 4.8, lon: -58.9 },
  "HT": { iso3: "HTI", num: "332", region: "Americas", lat: 18.9, lon: -72.2 },
  "HN": { iso3: "HND", num: "340", region: "Americas", lat: 15.2, lon: -86.2 },
  "HU": { iso3: "HUN", num: "348", region: "Europe", lat: 47.1, lon: 19.5 },
  "IS": { iso3: "ISL", num: "352", region: "Europe", lat: 64.9, lon: -19.0 },
  "IN": { iso3: "IND", num: "356", region: "Asia", lat: 20.5, lon: 78.9 },
  "ID": { iso3: "IDN", num: "360", region: "Asia", lat: -0.7, lon: 113.9 },
  "IR": { iso3: "IRN", num: "364", region: "Middle East", lat: 32.4, lon: 53.6 },
  "IQ": { iso3: "IRQ", num: "368", region: "Middle East", lat: 33.2, lon: 43.6 },
  "IE": { iso3: "IRL", num: "372", region: "Europe", lat: 53.4, lon: -8.2 },
  "IL": { iso3: "ISR", num: "376", region: "Middle East", lat: 31.0, lon: 34.8 },
  "IT": { iso3: "ITA", num: "380", region: "Europe", lat: 41.8, lon: 12.5 },
  "JM": { iso3: "JAM", num: "388", region: "Americas", lat: 18.1, lon: -77.2 },
  "JP": { iso3: "JPN", num: "392", region: "Asia", lat: 36.2, lon: 138.2 },
  "JO": { iso3: "JOR", num: "400", region: "Middle East", lat: 30.5, lon: 36.2 },
  "KZ": { iso3: "KAZ", num: "398", region: "Asia", lat: 48.0, lon: 66.9 },
  "KE": { iso3: "KEN", num: "404", region: "Africa", lat: -0.02, lon: 37.9 },
  "KI": { iso3: "KIR", num: "296", region: "Oceania", lat: 1.8, lon: -157.3 },
  "KP": { iso3: "PRK", num: "408", region: "Asia", lat: 40.3, lon: 127.5 },
  "KR": { iso3: "KOR", num: "410", region: "Asia", lat: 35.9, lon: 127.7 },
  "KW": { iso3: "KWT", num: "414", region: "Middle East", lat: 29.3, lon: 47.4 },
  "KG": { iso3: "KGZ", num: "417", region: "Asia", lat: 41.2, lon: 74.7 },
  "LA": { iso3: "LAO", num: "418", region: "Asia", lat: 19.8, lon: 102.4 },
  "LV": { iso3: "LVA", num: "428", region: "Europe", lat: 56.8, lon: 24.6 },
  "LB": { iso3: "LBN", num: "422", region: "Middle East", lat: 33.8, lon: 35.8 },
  "LS": { iso3: "LSO", num: "426", region: "Africa", lat: -29.6, lon: 28.2 },
  "LR": { iso3: "LBR", num: "430", region: "Africa", lat: 6.4, lon: -9.4 },
  "LY": { iso3: "LBY", num: "434", region: "Africa", lat: 26.3, lon: 17.2 },
  "LI": { iso3: "LIE", num: "438", region: "Europe", lat: 47.1, lon: 9.5 },
  "LT": { iso3: "LTU", num: "440", region: "Europe", lat: 55.1, lon: 23.8 },
  "LU": { iso3: "LUX", num: "442", region: "Europe", lat: 49.8, lon: 6.1 },
  "MG": { iso3: "MDG", num: "450", region: "Africa", lat: -18.7, lon: 46.8 },
  "MW": { iso3: "MWI", num: "454", region: "Africa", lat: -13.2, lon: 34.3 },
  "MY": { iso3: "MYS", num: "458", region: "Asia", lat: 4.2, lon: 101.9 },
  "MV": { iso3: "MDV", num: "462", region: "Asia", lat: 3.2, lon: 73.2 },
  "ML": { iso3: "MLI", num: "466", region: "Africa", lat: 17.5, lon: -3.9 },
  "MT": { iso3: "MLT", num: "470", region: "Europe", lat: 35.9, lon: 14.3 },
  "MH": { iso3: "MHL", num: "584", region: "Oceania", lat: 7.1, lon: 171.1 },
  "MR": { iso3: "MRT", num: "478", region: "Africa", lat: 21.0, lon: -10.9 },
  "MU": { iso3: "MUS", num: "480", region: "Africa", lat: -20.3, lon: 57.5 },
  "MX": { iso3: "MEX", num: "484", region: "Americas", lat: 23.6, lon: -102.5 },
  "FM": { iso3: "FSM", num: "583", region: "Oceania", lat: 7.4, lon: 150.5 },
  "MD": { iso3: "MDA", num: "498", region: "Europe", lat: 47.4, lon: 28.3 },
  "MC": { iso3: "MCO", num: "492", region: "Europe", lat: 43.7, lon: 7.4 },
  "MN": { iso3: "MNG", num: "496", region: "Asia", lat: 46.8, lon: 103.8 },
  "ME": { iso3: "MNE", num: "499", region: "Europe", lat: 42.7, lon: 19.3 },
  "MA": { iso3: "MAR", num: "504", region: "Africa", lat: 31.7, lon: -7.0 },
  "MZ": { iso3: "MOZ", num: "508", region: "Africa", lat: -18.6, lon: 35.5 },
  "MM": { iso3: "MMR", num: "104", region: "Asia", lat: 21.9, lon: 95.9 },
  "NA": { iso3: "NAM", num: "516", region: "Africa", lat: -22.9, lon: 18.4 },
  "NR": { iso3: "NRU", num: "520", region: "Oceania", lat: -0.5, lon: 166.9 },
  "NP": { iso3: "NPL", num: "524", region: "Asia", lat: 28.3, lon: 84.1 },
  "NL": { iso3: "NLD", num: "528", region: "Europe", lat: 52.1, lon: 5.2 },
  "NZ": { iso3: "NZL", num: "554", region: "Oceania", lat: -40.9, lon: 174.8 },
  "NI": { iso3: "NIC", num: "558", region: "Americas", lat: 12.8, lon: -85.2 },
  "NE": { iso3: "NER", num: "562", region: "Africa", lat: 17.6, lon: 8.0 },
  "NG": { iso3: "NGA", num: "566", region: "Africa", lat: 9.0, lon: 8.6 },
  "MK": { iso3: "MKD", num: "807", region: "Europe", lat: 41.6, lon: 21.7 },
  "NO": { iso3: "NOR", num: "578", region: "Europe", lat: 60.4, lon: 8.4 },
  "OM": { iso3: "OMN", num: "512", region: "Middle East", lat: 21.5, lon: 55.9 },
  "PK": { iso3: "PAK", num: "586", region: "Asia", lat: 30.3, lon: 69.3 },
  "PW": { iso3: "PLW", num: "585", region: "Oceania", lat: 7.5, lon: 134.5 },
  "PS": { iso3: "PSE", num: "275", region: "Middle East", lat: 31.9, lon: 35.2 },
  "PA": { iso3: "PAN", num: "591", region: "Americas", lat: 8.5, lon: -80.7 },
  "PG": { iso3: "PNG", num: "598", region: "Oceania", lat: -6.3, lon: 143.9 },
  "PY": { iso3: "PRY", num: "600", region: "Americas", lat: -23.4, lon: -58.4 },
  "PE": { iso3: "PER", num: "604", region: "Americas", lat: -9.1, lon: -75.0 },
  "PH": { iso3: "PHL", num: "608", region: "Asia", lat: 12.8, lon: 121.7 },
  "PL": { iso3: "POL", num: "616", region: "Europe", lat: 51.9, lon: 19.1 },
  "PT": { iso3: "PRT", num: "620", region: "Europe", lat: 39.3, lon: -8.2 },
  "QA": { iso3: "QAT", num: "634", region: "Middle East", lat: 25.3, lon: 51.1 },
  "RO": { iso3: "ROU", num: "642", region: "Europe", lat: 45.9, lon: 24.9 },
  "RU": { iso3: "RUS", num: "643", region: "Europe", lat: 61.5, lon: 105.3 },
  "RW": { iso3: "RWA", num: "646", region: "Africa", lat: -1.9, lon: 29.8 },
  "KN": { iso3: "KNA", num: "659", region: "Americas", lat: 17.3, lon: -62.7 },
  "LC": { iso3: "LCA", num: "662", region: "Americas", lat: 13.9, lon: -60.9 },
  "VC": { iso3: "VCT", num: "670", region: "Americas", lat: 12.9, lon: -61.2 },
  "WS": { iso3: "WSM", num: "882", region: "Oceania", lat: -13.7, lon: -172.1 },
  "SM": { iso3: "SMR", num: "674", region: "Europe", lat: 43.9, lon: 12.4 },
  "ST": { iso3: "STP", num: "678", region: "Africa", lat: 0.1, lon: 6.6 },
  "SA": { iso3: "SAU", num: "682", region: "Middle East", lat: 23.8, lon: 45.0 },
  "SN": { iso3: "SEN", num: "686", region: "Africa", lat: 14.4, lon: -14.4 },
  "RS": { iso3: "SRB", num: "688", region: "Europe", lat: 44.0, lon: 21.0 },
  "SC": { iso3: "SYC", num: "690", region: "Africa", lat: -4.6, lon: 55.4 },
  "SL": { iso3: "SLE", num: "694", region: "Africa", lat: 8.4, lon: -11.7 },
  "SG": { iso3: "SGP", num: "702", region: "Asia", lat: 1.3, lon: 103.8 },
  "SK": { iso3: "SVK", num: "703", region: "Europe", lat: 48.6, lon: 19.6 },
  "SI": { iso3: "SVN", num: "705", region: "Europe", lat: 46.1, lon: 14.9 },
  "SB": { iso3: "SLB", num: "090", region: "Oceania", lat: -9.6, lon: 160.1 },
  "SO": { iso3: "SOM", num: "706", region: "Africa", lat: 5.1, lon: 46.1 },
  "ZA": { iso3: "ZAF", num: "710", region: "Africa", lat: -30.5, lon: 22.9 },
  "SS": { iso3: "SSD", num: "728", region: "Africa", lat: 6.8, lon: 31.3 },
  "ES": { iso3: "ESP", num: "724", region: "Europe", lat: 40.4, lon: -3.7 },
  "LK": { iso3: "LKA", num: "144", region: "Asia", lat: 7.8, lon: 80.7 },
  "SD": { iso3: "SDN", num: "729", region: "Africa", lat: 12.8, lon: 30.2 },
  "SR": { iso3: "SUR", num: "740", region: "Americas", lat: 3.9, lon: -56.0 },
  "SE": { iso3: "SWE", num: "752", region: "Europe", lat: 60.1, lon: 18.6 },
  "CH": { iso3: "CHE", num: "756", region: "Europe", lat: 46.8, lon: 8.2 },
  "SY": { iso3: "SYR", num: "760", region: "Middle East", lat: 34.8, lon: 38.9 },
  "TW": { iso3: "TWN", num: "158", region: "Asia", lat: 23.6, lon: 120.9 },
  "TJ": { iso3: "TJK", num: "762", region: "Asia", lat: 38.8, lon: 71.2 },
  "TZ": { iso3: "TZA", num: "834", region: "Africa", lat: -6.3, lon: 34.8 },
  "TH": { iso3: "THA", num: "764", region: "Asia", lat: 15.8, lon: 100.9 },
  "TL": { iso3: "TLS", num: "626", region: "Asia", lat: -8.8, lon: 125.7 },
  "TG": { iso3: "TGO", num: "768", region: "Africa", lat: 8.6, lon: 0.8 },
  "TO": { iso3: "TON", num: "776", region: "Oceania", lat: -21.1, lon: -175.1 },
  "TT": { iso3: "TTO", num: "780", region: "Americas", lat: 10.6, lon: -61.2 },
  "TN": { iso3: "TUN", num: "788", region: "Africa", lat: 33.8, lon: 9.5 },
  "TR": { iso3: "TUR", num: "792", region: "Middle East", lat: 38.9, lon: 35.2 },
  "TM": { iso3: "TKM", num: "795", region: "Asia", lat: 38.9, lon: 59.5 },
  "TV": { iso3: "TUV", num: "798", region: "Oceania", lat: -7.1, lon: 177.6 },
  "UG": { iso3: "UGA", num: "800", region: "Africa", lat: 1.3, lon: 32.2 },
  "UA": { iso3: "UKR", num: "804", region: "Europe", lat: 48.3, lon: 31.1 },
  "AE": { iso3: "ARE", num: "784", region: "Middle East", lat: 23.4, lon: 53.8 },
  "GB": { iso3: "GBR", num: "826", region: "Europe", lat: 55.3, lon: -3.4 },
  "US": { iso3: "USA", num: "840", region: "Americas", lat: 37.0, lon: -95.7 },
  "UY": { iso3: "URY", num: "858", region: "Americas", lat: -32.5, lon: -55.7 },
  "UZ": { iso3: "UZB", num: "860", region: "Asia", lat: 41.3, lon: 64.5 },
  "VU": { iso3: "VUT", num: "548", region: "Oceania", lat: -15.3, lon: 166.9 },
  "VE": { iso3: "VEN", num: "862", region: "Americas", lat: 6.4, lon: -66.5 },
  "VN": { iso3: "VNM", num: "704", region: "Asia", lat: 14.0, lon: 108.2 },
  "YE": { iso3: "YEM", num: "887", region: "Middle East", lat: 15.5, lon: 48.5 },
  "ZM": { iso3: "ZMB", num: "894", region: "Africa", lat: -13.1, lon: 27.8 },
  "ZW": { iso3: "ZWE", num: "716", region: "Africa", lat: -19.0, lon: 29.1 },
  "XK": { iso3: "XKX", num: "983", region: "Europe", lat: 42.6, lon: 20.9 },
  "EH": { iso3: "ESH", num: "732", region: "Africa", lat: 24.2, lon: -12.8 },
  "GL": { iso3: "GRL", num: "304", region: "Americas", lat: 71.7, lon: -42.6 },
  "PR": { iso3: "PRI", num: "630", region: "Americas", lat: 18.2, lon: -66.5 },
  "HK": { iso3: "HKG", num: "344", region: "Asia", lat: 22.3, lon: 114.1 },
  "MO": { iso3: "MAC", num: "446", region: "Asia", lat: 22.1, lon: 113.5 },
  "NC": { iso3: "NCL", num: "540", region: "Oceania", lat: -20.9, lon: 165.6 },
  "PF": { iso3: "PYF", num: "258", region: "Oceania", lat: -17.6, lon: -149.4 }
};

// Build master list combining ISO_META + Canada + Germany + US State Dept
const ca = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/snapshots/ca_global_affairs.json'), 'utf8'));
const de = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/snapshots/de_auswaertiges_amt.json'), 'utf8'));

const countries = {};

for (const [iso2, meta] of Object.entries(ISO_META)) {
  countries[iso2] = {
    iso2,
    iso3: meta.iso3,
    num: meta.num,
    name: iso2,
    slug: iso2.toLowerCase(),
    region: meta.region,
    lat: meta.lat,
    lon: meta.lon,
    embassySubdomain: iso2.toLowerCase()
  };
}

// Enrich with Germany
for (const v of Object.values(de.response)) {
  if (typeof v === 'object' && v.countryCode) {
    const iso2 = v.countryCode.toUpperCase();
    const iso3 = (v.iso3CountryCode || '').toUpperCase();
    if (countries[iso2]) {
      if (iso3) countries[iso2].iso3 = iso3;
      countries[iso2].deName = v.countryName;
    }
  }
}

// Enrich with Canada English names & slugs
for (const [key, val] of Object.entries(ca.data)) {
  const iso2 = (val['country-iso'] || key).toUpperCase();
  if (countries[iso2]) {
    countries[iso2].name = (val.eng?.name || val['country-eng'] || countries[iso2].name)
      .replace(' (Ivory Coast)', '')
      .replace('Korea, South', 'South Korea')
      .replace('Korea, North', 'North Korea');
    if (val.eng?.['url-slug']) {
      countries[iso2].slug = val.eng['url-slug'];
    }
  }
}

// Explicit fallback names for any not in CA
const FALLBACK_NAMES = {
  "US": "United States",
  "CA": "Canada",
  "PS": "Palestinian Territories",
  "XK": "Kosovo",
  "EH": "Western Sahara",
  "VA": "Vatican City",
  "MC": "Monaco",
  "SM": "San Marino",
  "NR": "Nauru",
  "TV": "Tuvalu",
  "PW": "Palau",
  "MH": "Marshall Islands",
  "FM": "Micronesia"
};

for (const [iso2, name] of Object.entries(FALLBACK_NAMES)) {
  if (countries[iso2] && countries[iso2].name === iso2) {
    countries[iso2].name = name;
    countries[iso2].slug = name.toLowerCase().replace(/\s+/g, '-');
  }
}

// Check any remaining 2-letter names
for (const c of Object.values(countries)) {
  if (c.name.length === 2 && c.deName) c.name = c.deName;
}

fs.writeFileSync(path.join(__dirname, '../data/countries.json'), JSON.stringify(countries, null, 2));
console.log('Generated data/countries.json with', Object.keys(countries).length, 'countries');
