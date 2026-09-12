import { describe, expect, it } from "vitest";
import { extractListingMedia, listingIdFromUrl, upgradeImageSize } from "./extract.js";

const CITYEXPERT_MARKDOWN = `
![swipe](https://img.cityexpert.rs/properties/1920x/54000/54541/slike/cityexpert.rs_-_nekretnina_id_-_54541_-_0214_-_20230225.jpg)
![swipe](https://img.cityexpert.rs/properties/1920x/54000/54541/slike/cityexpert.rs_-_nekretnina_id_-_54541_-_0215_-_20230225.jpg)
![](https://img.cityexpert.rs/properties/240x/54000/54541/slike/cityexpert.rs_-_nekretnina_id_-_54541_-_0214_-_20230225.jpg)
![floor plan](https://img.cityexpert.rs/properties/470x/54000/54541/tlocrt/54541_-_ground_floor.png)
[![](https://cityexpert.rs/assets/banner.png)](https://cityexpert.rs/karijera)
![](https://cityexpert.rs/assets/icons/property-details/floor-plan.svg)
[![property photo](https://img.cityexpert.rs/properties/470x/48000/48310/slike/other-listing.jpg)](https://cityexpert.rs/izdavanje-nekretnina/beograd/48310/dvosoban)
# Svetogorska Stari grad Izdavanje Stanova • ID54541
###### Površina
##### 105  m²
###### Struktura
##### Troiposoban
`;

describe("listingIdFromUrl", () => {
  it("reads cityexpert listing id from the path", () => {
    expect(
      listingIdFromUrl(
        "https://cityexpert.rs/izdavanje-nekretnina/beograd/54541/troiposoban-stan-svetogorska-stari-grad?",
      ),
    ).toBe("54541");
  });
});

describe("upgradeImageSize", () => {
  it("rewrites cityexpert size folders to 1920x", () => {
    expect(
      upgradeImageSize(
        "https://img.cityexpert.rs/properties/470x/54000/54541/tlocrt/54541_-_ground_floor.png",
      ),
    ).toBe("https://img.cityexpert.rs/properties/1920x/54000/54541/tlocrt/54541_-_ground_floor.png");
  });
});

describe("extractListingMedia", () => {
  it("keeps the floor plan and unique 1920px photos for this listing only", () => {
    const media = extractListingMedia({
      url: "https://cityexpert.rs/izdavanje-nekretnina/beograd/54541/troiposoban-stan-svetogorska-stari-grad",
      markdown: CITYEXPERT_MARKDOWN,
    });

    expect(media.listingId).toBe("54541");
    expect(media.areaSqm).toBe(105);
    expect(media.roomsLabel).toBe("Troiposoban");
    expect(media.floorPlanUrls).toEqual([
      "https://img.cityexpert.rs/properties/1920x/54000/54541/tlocrt/54541_-_ground_floor.png",
    ]);
    expect(media.photoUrls).toEqual([
      "https://img.cityexpert.rs/properties/1920x/54000/54541/slike/cityexpert.rs_-_nekretnina_id_-_54541_-_0214_-_20230225.jpg",
      "https://img.cityexpert.rs/properties/1920x/54000/54541/slike/cityexpert.rs_-_nekretnina_id_-_54541_-_0215_-_20230225.jpg",
    ]);
  });

  it("keeps every floor plan and skips off-host SSRF urls", () => {
    const media = extractListingMedia({
      url: "https://cityexpert.rs/izdavanje-nekretnina/beograd/54541/stan",
      markdown: `
![](https://img.cityexpert.rs/properties/470x/54000/54541/tlocrt/ground.png)
![](https://img.cityexpert.rs/properties/470x/54000/54541/tlocrt/first.png)
![](https://img.cityexpert.rs/properties/1920x/54000/54541/slike/room.avif)
![](/properties/1920x/54000/54541/slike/relative.jpg)
![](https://img.cityexpert.rs/properties/1920x/54000/54541/slike/no-ext)
![](https://127.0.0.1/54541/slike/pwn.jpg)
![](https://evil.example/54541/slike/pwn.jpg)
`,
    });

    expect(media.floorPlanUrls).toEqual([
      "https://img.cityexpert.rs/properties/1920x/54000/54541/tlocrt/ground.png",
      "https://img.cityexpert.rs/properties/1920x/54000/54541/tlocrt/first.png",
    ]);
    expect(media.photoUrls).toEqual([
      "https://img.cityexpert.rs/properties/1920x/54000/54541/slike/room.avif",
      "https://img.cityexpert.rs/properties/1920x/54000/54541/slike/relative.jpg",
      "https://img.cityexpert.rs/properties/1920x/54000/54541/slike/no-ext",
    ]);
  });
});
