// Sample Scores for the demo page (demo.html). Public-domain works; titles and composer names in the original language.
// style "chant": square notes with the Latin text; "modern": two staves. parts: role codes the Score is used for.

export const SAMPLE_SCORES = [
  {
    key: "kyrie",
    title: "Kyrie (Missa de Angelis)",
    composer: null,
    style: "chant",
    pages: 1,
    mode: "modal",
    parts: ["kyrie"],
    text: "Ky-ri-e e-le-i-son. Ky-ri-e e-le-i-son. Ky-ri-e e-le-i-son. Chri-ste e-le-i-son. Chri-ste e-le-i-son. Chri-ste e-le-i-son. Ky-ri-e e-le-i-son. Ky-ri-e e-le-i-son. Ky-ri-e e-le-i-son."
  },
  {
    key: "gloria",
    title: "Gloria (Missa de Angelis)",
    composer: null,
    style: "chant",
    pages: 2,
    mode: "modal",
    parts: ["gloria"],
    text: [
      "Glo-ri-a in ex-cel-sis De-o. Et in ter-ra pax ho-mi-ni-bus bo-nae vo-lun-ta-tis.",
      "Lau-da-mus te. Be-ne-di-ci-mus te. A-do-ra-mus te. Glo-ri-fi-ca-mus te.",
      "Gra-ti-as a-gi-mus ti-bi prop-ter ma-gnam glo-ri-am tu-am.",
      "Do-mi-ne De-us, Rex cae-le-stis, De-us Pa-ter om-ni-po-tens.",
      "Do-mi-ne Fi-li u-ni-ge-ni-te, Ie-su Chri-ste.",
      "Do-mi-ne De-us, A-gnus De-i, Fi-li-us Pa-tris.",
      "Qui tol-lis pec-ca-ta mun-di, mi-se-re-re no-bis.",
      "Qui tol-lis pec-ca-ta mun-di, sus-ci-pe de-pre-ca-ti-o-nem no-stram.",
      "Qui se-des ad dex-te-ram Pa-tris, mi-se-re-re no-bis.",
      "Quo-ni-am tu so-lus San-ctus, tu so-lus Do-mi-nus, tu so-lus Al-tis-si-mus, Ie-su Chri-ste.",
      "Cum San-cto Spi-ri-tu, in glo-ri-a De-i Pa-tris. A-men."
    ].join(" ")
  },
  {
    key: "veni",
    title: "Veni Creator Spiritus",
    composer: null,
    style: "chant",
    pages: 1,
    mode: "modal",
    parts: ["entrance"],
    text: [
      "Ve-ni, Cre-a-tor Spi-ri-tus, men-tes tu-o-rum vi-si-ta, im-ple su-per-na gra-ti-a, quae tu cre-a-sti pe-cto-ra.",
      "Qui di-ce-ris Pa-ra-cli-tus, al-tis-si-mi do-num De-i, fons vi-vus, i-gnis, ca-ri-tas, et spi-ri-ta-lis unc-ti-o."
    ].join(" ")
  },
  {
    key: "adoro",
    title: "Adoro te devote",
    composer: null,
    style: "chant",
    pages: 1,
    mode: "modal",
    parts: ["communion", "meditation"],
    text: [
      "A-do-ro te de-vo-te, la-tens De-i-tas, quae sub his fi-gu-ris ve-re la-ti-tas:",
      "ti-bi se cor me-um to-tum sub-ii-cit, qui-a te con-tem-plans to-tum de-fi-cit."
    ].join(" ")
  },
  {
    key: "salve",
    title: "Salve Regina",
    composer: null,
    style: "chant",
    pages: 1,
    mode: "modal",
    parts: ["recessional"],
    text: [
      "Sal-ve, Re-gi-na, ma-ter mi-se-ri-cor-di-ae, vi-ta, dul-ce-do, et spes no-stra, sal-ve.",
      "Ad te cla-ma-mus, ex-su-les fi-li-i E-vae. Ad te su-spi-ra-mus, ge-men-tes et flen-tes in hac la-cri-ma-rum val-le."
    ].join(" ")
  },
  {
    key: "sicut",
    title: "Sicut cervus",
    composer: "Giovanni Pierluigi da Palestrina",
    year: 1584,
    style: "modern",
    pages: 2,
    meter: [4, 4],
    parts: ["responsorial_psalm"]
  },
  {
    key: "bach",
    title: "Jesus bleibet meine Freude, BWV 147",
    composer: "Johann Sebastian Bach",
    year: 1723,
    tonic: "G",
    mode: "major",
    style: "modern",
    pages: 2,
    meter: [3, 4],
    parts: ["prelude", "entrance"]
  },
  {
    key: "mozart",
    title: "Ave verum corpus, KV 618",
    composer: "Wolfgang Amadeus Mozart",
    year: 1791,
    tonic: "D",
    mode: "major",
    style: "modern",
    pages: 2,
    meter: [2, 2],
    parts: ["communion"],
    note: "Choir and organ. Short organ introduction."
  },
  {
    key: "schubert",
    title: "Ave Maria, D 839",
    composer: "Franz Schubert",
    year: 1825,
    tonic: "Bb",
    mode: "major",
    style: "modern",
    pages: 2,
    meter: [4, 4],
    parts: ["meditation"]
  },
  {
    key: "faure",
    title: "Cantique de Jean Racine, Op. 11",
    composer: "Gabriel Fauré",
    year: 1865,
    tonic: "Db",
    mode: "major",
    style: "modern",
    pages: 3,
    meter: [4, 4],
    parts: ["offertory"]
  },
  {
    key: "franck",
    title: "Panis angelicus",
    composer: "César Franck",
    year: 1872,
    tonic: "A",
    mode: "major",
    style: "modern",
    pages: 2,
    meter: [3, 4],
    parts: ["communion", "offertory"]
  },
  {
    key: "widor",
    title: "Toccata (Symphonie pour orgue n° 5)",
    composer: "Charles-Marie Widor",
    year: 1879,
    tonic: "F",
    mode: "major",
    style: "modern",
    pages: 3,
    meter: [2, 4],
    parts: ["postlude"]
  }
];
