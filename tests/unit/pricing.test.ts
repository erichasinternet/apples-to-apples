import {
  extractPackCount,
  findBestPrice,
  isLikelyPackageQuantity,
  parseFactoredPackageQuantities,
  parseMoneyValues,
  parseNativeUnitPrices,
  parseQuantities,
  selectPackageQuantity,
  selectProductUseQuantity,
  specializePackageQuantity
} from "../../src/core/pricing";
import { normalizeProduct } from "../../src/core/normalizer";
import { DEFAULT_PREFERENCES, type ProductInput } from "../../src/core/types";

describe("price parsing", () => {
  it("parses ordinary dollar prices and Walmart split cents", () => {
    expect(parseMoneyValues("current price $14.83")[0]?.cents).toBe(1483);
    expect(parseMoneyValues("$14 83")[0]?.cents).toBe(1483);
    expect(parseMoneyValues("Now $1,249.99")[0]?.cents).toBe(124999);
  });

  it("prefers current sale price over was price", () => {
    expect(findBestPrice("current price Now $17.83, Was $19.97")?.cents).toBe(1783);
  });

  it("prefers a single-item price over a multi-buy offer total", () => {
    expect(
      findBestPrice("Current sale price is 2/$15.00 or 1/$8.99")?.cents
    ).toBe(899);
  });
});

describe("unit price parsing", () => {
  it.each([
    ["67.4 ¢/lb", 67.4, "lb"],
    ["9.2¢/oz", 9.2, "oz"],
    ["$1.76/lb", 176, "lb"],
    ["$0.12/fl oz", 12, "fl_oz"],
    ["44.0 cents/count", 44, "each"]
  ])("parses %s", (text, cents, unit) => {
    const parsed = parseNativeUnitPrices(text)[0];
    expect(parsed?.centsPerUnit).toBeCloseTo(cents);
    expect(parsed?.unit).toBe(unit);
  });

  it("keeps fluid ounces separate from weight ounces", () => {
    expect(parseNativeUnitPrices("$0.12/fl oz")[0]?.dimension).toBe("volume");
    expect(parseNativeUnitPrices("9.2 ¢/oz")[0]?.dimension).toBe("mass");
  });

  it("parses unit pricing split by retailer grouping punctuation", () => {
    expect(parseNativeUnitPrices("$0.39 ( /ct.)")[0]).toMatchObject({
      centsPerUnit: 39,
      unit: "each",
      dimension: "count"
    });
  });

  it("parses common area and length unit-price spellings", () => {
    expect(parseNativeUnitPrices("$1.84/sqft")[0]).toMatchObject({
      centsPerUnit: 184,
      unit: "sq_ft",
      dimension: "area"
    });
    expect(parseNativeUnitPrices("$0.65 per yard")[0]).toMatchObject({
      centsPerUnit: 65,
      unit: "yd",
      dimension: "length"
    });
    expect(parseNativeUnitPrices("$9.80 per yard")[0]?.centsPerUnit).toBe(980);
    expect(parseNativeUnitPrices("$13.00/ linear yard")[0]).toMatchObject({
      centsPerUnit: 1300,
      unit: "yd"
    });
  });
});

describe("quantity parsing", () => {
  it.each([
    ["Purina Tidy Cats 17 lb Pail", 17, "lb"],
    ["12 x 16.9 fl oz bottles", 202.8, "fl_oz"],
    ["4 Pack of 25 count wipes", 100, "each"],
    ["Paper Towels 612 sq ft", 612, "sq_ft"],
    ["Coffee Pods 72 ct", 72, "each"],
    ["Trash Bags 120 count 13 gal", 13, "gal"],
    ["Aluminum Foil, 12\"x1000 ft Roll", 1000, "ft"]
  ])("extracts package size from %s", (text, value, unit) => {
    const selected = selectPackageQuantity(parseQuantities(text));
    expect(selected?.value).toBeCloseTo(value);
    expect(selected?.unit).toBe(unit);
  });

  it("parses compact quantities without treating attached product codes as count", () => {
    expect(parseQuantities("Nutrabio Multi Collagen 1lb")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 1, unit: "lb" })
      ])
    );
    expect(
      parseQuantities("Trash Bags 100 Box (CLO 78526CT)").some(
        (quantity) => quantity.value === 78526
      )
    ).toBe(false);
    expect(parseQuantities("Softsoap Pumps CPCUS04964CT")).toEqual([]);
    expect(parseQuantities("Cast Padding 4 in x 10 yds")).toContainEqual(
      expect.objectContaining({ value: 10, unit: "yd" })
    );
    expect(parseQuantities("$137.12 CT Add to Cart")).toEqual([]);
    expect(parseQuantities("Napkins, 8000/Cs")).toContainEqual(
      expect.objectContaining({ value: 8000, unit: "each" })
    );
  });

  it("captures multipack count separately", () => {
    expect(extractPackCount("Fresh scent refill, 4 Pack")).toBe(4);
    expect(extractPackCount("6-Pk 27-Gal Sterilite Large Storage Bins")).toBe(6);
    expect(extractPackCount("Hand soap, 7.5 oz, Pack of 6 bottles")).toBe(6);
    expect(extractPackCount("Hand soap, 7.5 fl oz, 6/Carton")).toBe(6);
    expect(extractPackCount("Hand soap, 11.25 oz, Total Qty 6")).toBe(6);
    expect(extractPackCount("100 Count -- 8 Per Case")).toBe(8);
    expect(extractPackCount("25 Bags/Roll, 8 Rolls/Box")).toBe(8);
    expect(extractPackCount("1600 mL Refills, Case of 4")).toBe(4);
    expect(extractPackCount("150 oz Bottle 4 Carton")).toBe(4);
    expect(extractPackCount("4 in x 4 yds, 12/Bag")).toBe(12);
    expect(extractPackCount("500 Sheets per Ream, 40 / Pallet")).toBe(40);
    expect(extractPackCount("1.8mL, 50/bx")).toBe(50);
  });

  it("parses one-digit slash pack counts", () => {
    expect(parseQuantities("Alkaline Batteries, 8 / Pack")).toContainEqual(
      expect.objectContaining({ value: 8, unit: "each", dimension: "count" })
    );
  });

  it("specializes count-worded product-use units from the title", () => {
    for (const [title, expectedUnit] of [
      ["Gain Flings Laundry Detergent Pacs, 12 Count", "pod"],
      ["Washing Machine Cleaner Tablets, 6 Count", "tablet"],
      ["Laundry Detergent Sheets, 30 Count", "sheet"]
    ] as const) {
      const quantity = parseQuantities(title).find(
        (candidate) => candidate.dimension === "count"
      );
      expect(quantity).toBeDefined();
      expect(specializePackageQuantity(title, quantity!).unit).toBe(expectedUnit);
    }

    const paperTowelTitle = "Paper Towels, 12 Count, Choose-A-Sheet";
    const paperTowelCount = parseQuantities(paperTowelTitle).find(
      (candidate) => candidate.dimension === "count"
    );
    expect(paperTowelCount).toBeDefined();
    expect(specializePackageQuantity(paperTowelTitle, paperTowelCount!).unit).toBe(
      "each"
    );
  });

  it("does not turn accessory counts into the product they store or discard", () => {
    for (const title of [
      "Laundry Detergent Pods Storage Containers, 2 Count, 64 oz capacity",
      "Reusable Coffee Pod Filters, 4 Count",
      "Ubbi Diaper Disposal Bags, 75 Count",
      "Avery Index Tabs, 25 Count"
    ]) {
      const quantity = parseQuantities(title).find(
        (candidate) => candidate.dimension === "count"
      );
      expect(quantity).toBeDefined();
      expect(specializePackageQuantity(title, quantity!).unit).toBe("each");
    }
  });

  it.each([
    ["2 x 12 oz bottles", 12, 2, "oz"],
    ["90 each x 6 pack", 90, 6, "each"],
    ["4 Pack of 25 count wipes", 25, 4, "each"]
  ])("keeps factored package quantities for %s", (text, value, packs, unit) => {
    expect(parseFactoredPackageQuantities(text)[0]).toMatchObject({
      valuePerPackage: value,
      packCount: packs,
      unit
    });
  });

  it.each([
    ["Lenovo 15.1 in Gaming Laptop", "15.1 in", false],
    ["Lenovo Gaming Laptop, 4.19 lb", "4.19 lb", false],
    ["Casebound Notebooks, 24 lb Basis Weight Paper", "24 lb", false],
    ["USB-C Laptop Cable, 10 ft", "10 ft", true],
    ["Aluminum Foil, 75 ft", "75 ft", true],
    ["50-Pack Aluminum Foil Pans, 8x8x2 Inch", "2 Inch", false],
    ["Pre-Cut Aluminum Foil Sheets, 14 x 10.25 Inches, 50 Sheets", "10.25 Inches", false],
    ["Trash Liner, 38 x 58 in, 200 per case", "38 x 58 in", false],
    ["Automatic Soap Dispenser, 1200 mL", "1200 mL", false],
    ["3 mL Luer-Lok Syringes, 100 Count", "3 mL", false],
    ["Clear Deli Container, 32 oz, 240 per case", "32 oz", false],
    ["32 oz Amber Glass Bottle with Cap", "32 oz", false],
    ["Olive Oil, 1 Gallon PET Plastic Bottle", "1 Gallon", true],
    ["Pool Shock, 25 lb Bucket", "25 lb", true],
    ["Commercial Vacuum Cleaner, 1 Each", "1 Each", false],
    ["ActiveLife 1-Piece Drainable Ostomy Bag", "1-Piece", false],
    ["Cat Litter, 20 lb", "20 lb", true],
    ["SafePro 9-Inch Paper Plates, 400/CS", "9-Inch", false],
    ["Reusable Underpad 34 X 36 Inch", "36 Inch", false],
    ["2 inch Webbing (Sold per Yard)", "2 inch", false],
    ["Webbing, 4 yard roll", "4 yard", true],
    ["Clear 1.5 Oz Ramekin", "1.5 Oz", false],
    ["IV Catheter 20G x 1 inch", "20G", false],
    ["Paper Straws 7.75-inch, 3000/CS", "7.75-inch", false],
    ["Nano Mosaic Tile 3mm, 135 tiles", "5 g", false],
    ["Disposable Underpad 90 gram, 100/CS", "90 gram", false],
    ["Carter Tea Infuser Set 16oz", "16oz", false],
    ["Quilt Yardage SKU# 10596-L", "96-L", false],
    ["Foil Pan 9.75L x 7.75W, 250/CS", "9.75L", false],
    ["Dental Needle 27ga Long 30mm 100/Box", "27L", false],
    ["Water Filtration Unit 15 gal/min", "15 gal", false],
    ["Sterilite 15 Qt Storage Tote", "15 Qt", false],
    ["6-Pk 27-Gal Sterilite Large Storage Bins (Black/Yellow)", "27-Gal", false],
    ["Sterilite Large Storage Bin, 27 Gallon Durable Plastic Storage Tote", "27 Gallon", false],
    ["Liquid Laundry Fabric Softener, 34 fl oz, 50 Loads", "34 fl oz", true],
    ["Only 2 left!", "2 L", false],
    ["Paper Hot Cups, 16 Oz, 1000/carton", "16 Oz", false],
    ["Square Dance Yardage SKU# 10080-G", "10080-G", false],
    ["Paper Cups, 50/Pack, 20/Carton", "50/Pack", false],
    ["Paper Hot Cups, 15 Bags/40 Cups = 600/CTN", "15 Bags", false],
    ["Fusible Fleece 45in by the yard", "45in", false],
    ["Square Dance Yardage SKU# 10080-G", "10080-G", false],
    ["Quilt Panel SKU# 10596-L", "10596-L", false],
    ["Kleenex Paper Towels", "20-L", false],
    ["Heather Gray 17 oz Cotton Fleece Fabric", "17 oz", false],
    ["Wire Wheel Brush, 16 Inch", "16 Inch", false],
    ["Ziploc Storage Bags, 1 gal", "1 gal", false],
    ["Glass Bottles, 6 Cap", "6 Cap", false],
    ["Bouffant Caps, model 9100-310L", "310L", false],
    ["Toner Mate 2 in 1 Cotton Pads", "2 in", false],
    [
      '65" 10.5 Ounce SeaFab Poly/Cotton Boat Duck @ $13.00/ linear yard',
      "10.5 Ounce",
      false
    ],
    [
      "Bagcraft 15x16-Inch Insulated Kraft Paper Wrap, 1000/CS",
      "15x16-Inch",
      false
    ],
    ["2-Ounce Ice Cream Disher with Blue Handle", "2-Ounce", false],
    ["C.A.C. China KC-1-G Coffee Cup", "1-G", false],
    ["PacknWood 15-inch Greaseproof Kraft Paper, 500/CS", "15-inch", false],
    ["Paper Single Wall Coffee Cup, 16 oz, 400 count box", "16 oz", false],
    ["Paper Medical Funnel Cups, 6 Oz, 250/bag", "6 Oz", false],
    ["Super Value Pack, 30 Gal, 0.65 Mil, 60/box Handi-Bag", "30 Gal", false]
  ])("classifies sale quantity semantics for %s", (title, quantityText, expected) => {
    const quantity = parseQuantities(quantityText)[0];
    expect(quantity).toBeDefined();
    expect(isLikelyPackageQuantity(title, quantity!)).toBe(expected);
  });
});

describe("normalization", () => {
  it("converts cents per ounce to dollars per pound", () => {
    const product = makeProduct("Tidy Cats LightWeight 17 lb Pail", "$24.97 9.2 ¢/oz");
    const normalized = normalizeProduct(product).normalized;
    expect(normalized?.display).toBe("$1.47/lb");
  });

  it("converts a per-yard price to the preferred per-foot unit", () => {
    const product = makeProduct("Marine fabric sold by the yard", "$0.65 per yard");
    const normalized = normalizeProduct(product).normalized;
    expect(normalized?.unit).toBe("ft");
    expect(normalized?.centsPerUnit).toBeCloseTo(65 / 3);
    expect(normalized?.display).toBe("21.7¢/ft");
  });

  it("uses package math when native unit price is missing", () => {
    const product = makeProduct("Special Kitty Cat Litter 20 lbs Jug", "$7.86");
    const normalized = normalizeProduct(product).normalized;
    expect(normalized?.display).toBe("39.3¢/lb");
  });

  it("does not compare unlike count units", () => {
    const product = makeProduct("Gift Wrap 12 rolls", "$18.00");
    const normalized = normalizeProduct(product, {
      ...DEFAULT_PREFERENCES,
      preferredUnits: {
        ...DEFAULT_PREFERENCES.preferredUnits,
        count: "each"
      }
    }).normalized;
    expect(normalized?.unit).toBe("roll");
    expect(normalized?.display).toBe("$1.50/roll");
  });

  it("normalizes detergent by fluid ounce from package math", () => {
    const product = makeProduct("FreshWash Concentrated Laundry Detergent, 154 fl oz, 107 loads", "$18.48");
    const normalized = normalizeProduct(product).normalized;
    expect(normalized?.compareKey).toBe("volume:fl_oz");
    expect(normalized?.display).toBe("12¢/fl oz");
  });

  it("prefers explicit liquid-detergent volume over a native package-weight rate", () => {
    const product = makeProduct(
      "Method Laundry Detergent, Beach Sage, 53.5 fl oz, 66 Loads",
      "$16.68 $4.42/lb"
    );

    expect(normalizeProduct(product).normalized).toMatchObject({
      dimension: "volume",
      unit: "fl_oz",
      display: "31.2¢/fl oz",
      compareKey: "volume:fl_oz"
    });
  });

  it("does not apply liquid-detergent precedence to unrelated products", () => {
    const product = makeProduct(
      "Maple Syrup, 12 fl oz",
      "$9.00 $6.00/lb"
    );

    expect(normalizeProduct(product).normalized).toMatchObject({
      dimension: "mass",
      unit: "lb",
      display: "$6.00/lb"
    });
  });

  it("prefers an explicit detergent-pod count over a native package-weight rate", () => {
    const title = "Gain Flings Laundry Detergent Soap Pacs, Original, 12 Count";
    const count = parseQuantities(title).find(
      (quantity) => quantity.dimension === "count"
    );
    expect(count).toBeDefined();

    const product: ProductInput = {
      id: title,
      site: "test",
      pageType: "search",
      title,
      price: { cents: 397, currency: "USD", sourceText: "$3.97", index: 0 },
      nativeUnitPrice: {
        centsPerUnit: 49.6,
        unit: "oz",
        dimension: "mass",
        sourceText: "49.6 ¢/oz",
        index: 6
      },
      packageQuantity: specializePackageQuantity(title, count!),
      evidence: []
    };

    expect(normalizeProduct(product).normalized).toMatchObject({
      unit: "pod",
      dimension: "count",
      display: "33.1¢/pod",
      compareKey: "count:pod"
    });
  });

  it("uses fluid-ounce package math when a liquid native rate omits fluid", () => {
    const product = makeProduct(
      "Dove Shampoo, 12 fl oz",
      "$6.29 $0.52 / oz"
    );

    expect(normalizeProduct(product).normalized).toMatchObject({
      dimension: "volume",
      unit: "fl_oz",
      display: "52.4¢/fl oz"
    });
  });

  it("uses a liquid package to disambiguate a native per-ounce rate", () => {
    const product = makeProduct(
      "Purified Water, 24 Pack, 16.9 Oz Bottles",
      "1¢/oz"
    );

    expect(normalizeProduct(product).normalized).toMatchObject({
      dimension: "volume",
      unit: "fl_oz",
      display: "1¢/fl oz"
    });
  });

  it("abstains when an omitted-fluid native rate is actually the item price", () => {
    const product = makeProduct(
      "Head & Shoulders Shampoo, 12.5 fl oz",
      "$8.99 $8.99 / oz"
    );

    expect(normalizeProduct(product).normalized).toBeUndefined();
  });

  it("does not treat solid food containing olive oil as fluid volume", () => {
    const quantity = parseQuantities("0.7 Ounce")[0]!;
    expect(
      specializePackageQuantity(
        "Organic Olive Oil Roasted Seaweed Snacks, 0.7 Ounce",
        quantity
      )
    ).toMatchObject({ unit: "oz", dimension: "mass" });
  });

  it("keeps solid detergent forms and in-wash beads as package mass", () => {
    for (const title of [
      "Persil Activewear Clean Laundry Detergent Ultra Pacs, 8.04 oz, 12 Count",
      "Ariel Powder Laundry Detergent, 70 oz, 44 Loads",
      "In-Wash Scent Booster Beads, 13.4 oz"
    ]) {
      const quantity = parseQuantities(title).find(
        (candidate) => candidate.unit === "oz"
      );
      expect(quantity).toBeDefined();
      expect(specializePackageQuantity(title, quantity!)).toMatchObject({
        unit: "oz",
        dimension: "mass"
      });
    }
  });

  it("still treats ounce-labeled liquid detergent as fluid volume", () => {
    const title = "all Baby Liquid Laundry Detergent, 73 oz, 58 Loads";
    const quantity = parseQuantities(title).find(
      (candidate) => candidate.unit === "oz"
    );
    expect(quantity).toBeDefined();
    expect(specializePackageQuantity(title, quantity!)).toMatchObject({
      unit: "fl_oz",
      dimension: "volume"
    });
  });

  it("treats ambiguous cleaner ounces as liquid volume", () => {
    const quantity = parseQuantities("32 oz")[0]!;
    expect(
      specializePackageQuantity("Wheel Cleaner 32 oz", quantity)
    ).toMatchObject({ unit: "fl_oz", dimension: "volume" });
  });

  it("treats common liquid-product ounces as fluid volume", () => {
    for (const title of [
      "Purified Water, 16.9 oz Bottles",
      "Interior Cleaning Gel, 16 oz",
      "Spa Defoamer, 16 oz",
      "Pet Urine Destroyer, 35 oz"
    ]) {
      expect(
        specializePackageQuantity(title, parseQuantities(title)[0]!)
      ).toMatchObject({ unit: "fl_oz", dimension: "volume" });
    }
  });

  it("does not multiply an explicit parenthetical total count twice", () => {
    const product = makeProduct(
      "Underpads, 50/Pack, Case of 3 (150 Count)",
      "$67.95"
    );

    expect(normalizeProduct(product).normalized?.display).toBe("45.3¢/count");
  });

  it("abstains when a semantic count and trailing multipack are ambiguous", () => {
    const product = makeProduct(
      "Tide PODS Laundry Detergent, 42 Count (Pack of 3)",
      "$15.00"
    );

    expect(product).toMatchObject({
      packCount: 3,
      packageQuantity: { value: 42, unit: "pod" }
    });
    expect(normalizeProduct(product).normalized).toBeUndefined();
  });

  it("also abstains when a parenthetical semantic count lacks a total label", () => {
    for (const title of [
      "Tide PODS Laundry Detergent, Pack of 3 (42 Count)",
      "Tide PODS Laundry Detergent, Pack of 3 (42 Pods)"
    ]) {
      const product = makeProduct(title, "$15.00");
      expect(product).toMatchObject({
        packCount: 3,
        packageQuantity: { value: 42, unit: "pod" }
      });
      expect(normalizeProduct(product).normalized).toBeUndefined();
    }
  });

  it("uses an explicitly labeled semantic total count once", () => {
    for (const title of [
      "Tide PODS Laundry Detergent, 3 Pack, 42 Count Total",
      "Tide PODS Laundry Detergent, 3 Pack, 42 Pods Total"
    ]) {
      expect(normalizeProduct(makeProduct(title, "$15.00")).normalized?.display).toBe(
        "35.7¢/pod"
      );
    }
  });

  it("multiplies a semantic count when the title says it is per pack", () => {
    const product = makeProduct(
      "Laundry Detergent Pods, 12 Count per Pack, 3 Pack",
      "$12.00"
    );

    expect(normalizeProduct(product).normalized?.display).toBe("33.3¢/pod");
  });

  it("multiplies an explicit per-pack count even when it equals the pack count", () => {
    const product = makeProduct(
      "Laundry Detergent Pods, 3 Count per Pack, 3 Pack",
      "$9.00"
    );

    expect(normalizeProduct(product).normalized?.display).toBe("$1.00/pod");
  });

  it("does not fall back to a package-weight rate for an ambiguous pod multipack", () => {
    const product = makeProduct(
      "Tide PODS Laundry Detergent, 42 Count (Pack of 3)",
      "$15.00 50¢/oz"
    );

    expect(product).toMatchObject({
      nativeUnitPrice: { unit: "oz" },
      packageQuantity: { value: 42, unit: "pod" },
      packCount: 3
    });
    expect(normalizeProduct(product).normalized).toBeUndefined();
  });

  it("does not price a liquid-detergent bundle by its included dryer sheets", () => {
    for (const separator of ["+", "with", "and"]) {
      const product = makeProduct(
        `Tide Liquid Laundry Detergent, 92 fl oz ${separator} Bounce Dryer Sheets, 60 Count`,
        "$20.00 15¢/fl oz"
      );

      expect(product.packageQuantity).toMatchObject({
        value: 92,
        unit: "fl_oz",
        dimension: "volume"
      });
      expect(product.packageQuantity?.unit).not.toBe("sheet");
      expect(normalizeProduct(product).normalized).toBeUndefined();
    }
  });

  it("still prices a same-product detergent-sheet bundle per sheet", () => {
    const product = makeProduct(
      "Eco Laundry Detergent Sheets Bundle, 120 Count, 16 oz",
      "$24.00"
    );

    expect(product.packageQuantity).toMatchObject({
      value: 120,
      unit: "sheet",
      dimension: "count"
    });
    expect(normalizeProduct(product).normalized?.display).toBe("20¢/sheet");
  });

  it("abstains from detergent and fabric-softener bundles with separate sizes", () => {
    const product = makeProduct(
      "Tide Liquid Laundry Detergent, 92 fl oz + Downy Fabric Softener, 48 fl oz",
      "$20.00 15¢/fl oz"
    );

    expect(normalizeProduct(product).normalized).toBeUndefined();
  });

  it("still rejects appliance weight when dryer sheets are bundled with a dryer", () => {
    const product = makeProduct(
      "Samsung Electric Dryer with Bonus Dryer Sheets, 125 lb",
      "$699.00"
    );

    expect(normalizeProduct(product).normalized).toBeUndefined();
  });

  it("does not multiply total tile coverage by the tile count", () => {
    const product = makeProduct(
      "Porcelain Tile, 15.5 sq ft, 18 per carton",
      "$3.82"
    );

    expect(normalizeProduct(product).normalized?.display).toBe("24.6¢/sq ft");
  });

  it("normalizes paper towels by area when square footage is visible", () => {
    const product = makeProduct("Kitchen Roll Paper Towels, 12 rolls, 840 sheets, 612 sq ft", "$22.99");
    const normalized = normalizeProduct(product).normalized;
    expect(normalized?.compareKey).toBe("area:sq_ft");
    expect(normalized?.display).toBe("3.76¢/sq ft");
  });

  it("includes a separately stated pack count in package math", () => {
    const product = makeProduct(
      "Bounty Paper Towels, 108 sheets per roll, 4 pack",
      "$5.49"
    );

    expect(product.packCount).toBe(4);
    expect(normalizeProduct(product).normalized?.display).toBe("1.27¢/sheet");
  });

  it("does not multiply a factored package quantity twice", () => {
    const product = makeProduct("Cat Food, 4 pack of 12 oz cans", "$12.00");

    expect(normalizeProduct(product).normalized?.display).toBe("$4.00/lb");
  });

  it("does not multiply a slash-case total twice", () => {
    const product = makeProduct(
      "Clear Deli Container, 500/Case",
      "$100.00"
    );

    expect(product.packCount).toBe(500);
    expect(normalizeProduct(product).normalized?.display).toBe("20¢/count");
  });

  it("does not multiply duplicate each and per-box counts", () => {
    const product = makeProduct(
      "Toilet Seat Covers, 250 EA/BX, Quantity: 250 per Box",
      "$4.56"
    );

    expect(product.packCount).toBe(250);
    expect(normalizeProduct(product).normalized?.display).toBe("1.82¢/count");
  });

  it("prefers a specific package count over a native per-each rate", () => {
    const product = makeProduct(
      "Bounty Paper Towels, 108 sheets per roll, 4 pack",
      "$5.49 $1.37 / ea"
    );

    expect(normalizeProduct(product).normalized?.display).toBe("1.27¢/sheet");
  });

  it("treats a native per-item price as the case price when a piece count is explicit", () => {
    const product = makeProduct(
      "Flat Dry Wax Deli Paper, 3x1000-Piece Pack",
      "$55.99 / item"
    );

    expect(product.packageQuantity?.value).toBe(3000);
    expect(normalizeProduct(product).normalized?.display).toBe("1.87¢/count");
  });

  it("abstains when a retailer per-item price conflicts with an ambiguous each count", () => {
    const product = makeProduct(
      "Scott Paper Towels, Choose a Sheet - 6 ea",
      "$5.00 $5.00 / item"
    );

    expect(product.packageQuantity?.sourceText).toBe("6 ea");
    expect(normalizeProduct(product).normalized).toBeUndefined();
  });

  it("prefers meaningful package length over a native per-each rate", () => {
    const product = makeProduct(
      "Commercial Vacuum Hose, 50 ft",
      "$100.00 $100.00 / ea"
    );

    expect(normalizeProduct(product).normalized?.display).toBe("$2.00/ft");
  });

  it("rejects container capacity as package contents", () => {
    const title = "55 Gallon Trash Bags, Heavy Duty, 60 Count";
    const quantity = selectPackageQuantity(
      parseQuantities(title).filter((candidate) =>
        isLikelyPackageQuantity(title, candidate)
      )
    );
    const product: ProductInput = {
      id: title,
      site: "test",
      pageType: "search",
      title,
      price: { cents: 1800, currency: "USD", sourceText: "$18.00", index: 0 },
      evidence: [],
      ...(quantity ? { packageQuantity: quantity } : {})
    };

    expect(quantity?.unit).toBe("each");
    expect(normalizeProduct(product).normalized?.display).toBe("30¢/count");
  });

  it("does not produce a normalized result without a usable quantity or native unit price", () => {
    const product = makeProduct("Snack variety box, family size", "$12.99");
    expect(normalizeProduct(product).normalized).toBeUndefined();
  });
});

function makeProduct(title: string, text: string): ProductInput {
  const nativeUnitPrice = parseNativeUnitPrices(text)[0];
  const quantities = parseQuantities(`${title} ${text}`).map((quantity) =>
    specializePackageQuantity(title, quantity)
  );
  const price = findBestPrice(text);
  const packageQuantity =
    selectProductUseQuantity(title, quantities) ??
    selectPackageQuantity(quantities, nativeUnitPrice?.dimension);
  const packCount = extractPackCount(title);

  return {
    id: title,
    site: "test",
    pageType: "search",
    title,
    evidence: [],
    ...(price ? { price } : {}),
    ...(nativeUnitPrice ? { nativeUnitPrice } : {}),
    ...(packageQuantity ? { packageQuantity } : {}),
    ...(packCount ? { packCount } : {})
  };
}
