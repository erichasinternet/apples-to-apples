import { expect, test } from "@playwright/test";

const observation = {
  version: 1,
  pageId: "synthetic-review-page",
  url: "https://example.test/search",
  title: "Synthetic review page",
  viewport: { width: 600, height: 800, scrollX: 0, scrollY: 0 },
  rootNodeId: "root",
  nodes: [
    node("root", undefined, undefined, 0, 0, 600, 800, "main"),
    node("card", "root", undefined, 20, 100, 250, 300, "article"),
    node("title", "card", "Coffee, 12 oz", 35, 125, 200, 45),
    node("price", "card", "$12.00", 35, 190, 100, 35),
    node("quantity", "card", "12 oz", 35, 240, 100, 35),
    node("card2", "root", undefined, 320, 100, 250, 300, "article"),
    node("title2", "card2", "Coffee, 24 oz", 335, 125, 200, 45),
    node("price2", "card2", "$20.00", 335, 190, 100, 35),
    node("quantity2", "card2", "24 oz", 335, 240, 100, 35)
  ],
  truncated: false
};

const reviewTemplate = {
  version: 1,
  reviewId: "reviewer-a--synthetic-review-page",
  pageId: "synthetic-review-page",
  phase: "independent",
  reviewerId: "reviewer-a",
  completedAt: null,
  coverage: "complete-main-region",
  preannotationVisibility: "hidden",
  source: {
    observationSha256: "a".repeat(64),
    screenshotSha256: "b".repeat(64),
    captureTimestamp: "2026-07-25T00:00:00.000Z",
    registrableDomain: "example.test",
    cohort: "training"
  },
  products: []
};

test("builds and submits a blinded evidence-pointer review", async ({ page }) => {
  let submittedReview: unknown;
  await page.route("**/api/queue", async (route) => {
    await route.fulfill({
      json: {
        queueId: "synthetic-queue",
        reviewerId: "reviewer-a",
        cohort: "training",
        labelVisibility: "no model or peer labels",
        items: [
          {
            pageId: "synthetic-review-page",
            rootNodeId: "root",
            candidateCardNodeIds: ["card", "card2"],
            source: reviewTemplate.source,
            reviewTemplate,
            saved: false
          }
        ]
      }
    });
  });
  await page.route("**/api/observation?*", async (route) => {
    await route.fulfill({ json: observation });
  });
  await page.route("**/api/screenshot?*", async (route) => {
    await route.fulfill({
      contentType: "image/svg+xml",
      body: [
        '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800">',
        '<rect width="600" height="800" fill="#fff"/>',
        '<rect x="20" y="100" width="250" height="300" fill="#eef4ff" stroke="#1659c7"/>',
        '<rect x="320" y="100" width="250" height="300" fill="#eef4ff" stroke="#1659c7"/>',
        '<text x="35" y="150" font-size="22">Coffee, 12 oz</text>',
        '<text x="35" y="215" font-size="22">$12.00</text>',
        '<text x="335" y="150" font-size="22">Coffee, 24 oz</text>',
        '<text x="335" y="215" font-size="22">$20.00</text>',
        "</svg>"
      ].join("")
    });
  });
  await page.route("**/api/candidates?*", async (route) => {
    const second = new URL(route.request().url()).searchParams.get("cardNodeId") === "card2";
    await route.fulfill({
      json: {
        cardNodeId: second ? "card2" : "card",
        candidates: [
          {
            id: second ? "price2@p0" : "price@p0",
            kind: "current-price",
            nodeId: second ? "price2" : "price",
            sourceText: second ? "$20.00" : "$12.00",
            cents: second ? 2000 : 1200
          },
          {
            id: second ? "quantity2@q0" : "quantity@q0",
            kind: "package-quantity",
            nodeId: second ? "quantity2" : "quantity",
            sourceText: second ? "24 oz" : "12 oz",
            valuePerPackage: second ? 24 : 12,
            unit: "oz",
            dimension: "mass"
          }
        ]
      }
    });
  });
  await page.route("**/api/review", async (route) => {
    submittedReview = route.request().postDataJSON();
    await route.fulfill({ json: { valid: true } });
  });

  await page.goto("http://127.0.0.1:4173/review-workbench/");

  await expect(page.locator("#queueMeta")).toHaveText(
    "reviewer-a · training · blinded"
  );
  await expect(page.locator(".card-root-button")).toHaveCount(2);
  await expect(page.locator("#productCount")).toHaveText("0/2 cards");
  await expect(page.getByRole("button", { name: "Submit review" })).toBeDisabled();
  await page.getByRole("button", { name: "Review card 1 of 2" }).click();
  await expect(page.locator("#captureOverlay")).toBeVisible();
  await page.locator('#titleChoices input[value="title"]').check();
  await page.locator("#currentPrice").selectOption("price@p0");
  await page.locator("#packageQuantity").selectOption("quantity@q0");

  const expectedTarget = [
    "CARD card",
    "TITLE title",
    "CURRENT_PRICE price@p0",
    "NATIVE_UNIT_PRICE NONE",
    "PACKAGE_QUANTITY quantity@q0",
    "PACK_COUNT NONE",
    "STATUS comparable"
  ].join("\n");
  await expect(page.locator("#pointerPreview")).toHaveText(expectedTarget);

  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.locator("#products .product-row")).toHaveCount(1);
  await expect(page.locator("#productCount")).toHaveText("1/2 cards");
  await expect(page.locator("#pointerPreview")).toContainText("CARD card2");
  await expect(page.getByRole("button", { name: "Submit review" })).toBeDisabled();

  await page.locator('#titleChoices input[value="title2"]').check();
  await page.locator("#currentPrice").selectOption("price2@p0");
  await page.locator("#packageQuantity").selectOption("quantity2@q0");
  const expectedTarget2 = [
    "CARD card2",
    "TITLE title2",
    "CURRENT_PRICE price2@p0",
    "NATIVE_UNIT_PRICE NONE",
    "PACKAGE_QUANTITY quantity2@q0",
    "PACK_COUNT NONE",
    "STATUS comparable"
  ].join("\n");
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.locator("#productCount")).toHaveText("2/2 cards");
  await expect(page.getByRole("button", { name: "Submit review" })).toBeEnabled();
  await page.getByRole("button", { name: "Review card 1 of 2" }).click();
  await expect(page.locator("#currentPrice")).toHaveValue("price@p0");
  await expect(page.locator("#packageQuantity")).toHaveValue("quantity@q0");
  await expect(page.locator('#titleChoices input[value="title"]')).toBeChecked();
  await page.getByRole("button", { name: "Submit review" }).click();
  await expect(page.locator("#saveState")).toHaveText("Submitted");

  expect(submittedReview).toMatchObject({
    reviewId: "reviewer-a--synthetic-review-page",
    pageId: "synthetic-review-page",
    reviewerId: "reviewer-a",
    preannotationVisibility: "hidden",
    products: [
      {
        cardNodeId: "card",
        scope: "primary-results",
        target: expectedTarget
      },
      {
        cardNodeId: "card2",
        scope: "primary-results",
        target: expectedTarget2
      }
    ]
  });
});

test("resolves independent decisions in adjudication mode", async ({ page }, testInfo) => {
  let submittedReview: Record<string, unknown> | undefined;
  const sourceA = {
    ...reviewTemplate,
    completedAt: "2026-07-25T01:00:00.000Z",
    products: [
      {
        cardNodeId: "card",
        scope: "primary-results",
        target: target("price@p0")
      }
    ]
  };
  const sourceB = {
    ...reviewTemplate,
    reviewId: "reviewer-b--synthetic-review-page",
    reviewerId: "reviewer-b",
    completedAt: "2026-07-25T01:05:00.000Z",
    products: [
      {
        cardNodeId: "card",
        scope: "primary-results",
        target: target("price-alt@p0")
      }
    ]
  };
  const adjudicationTemplate = {
    ...reviewTemplate,
    reviewId: "reviewer-c--synthetic-review-page",
    phase: "adjudicated",
    reviewerId: "reviewer-c",
    preannotationVisibility: "shown-after-submit",
    sourceReviewIds: [sourceA.reviewId, sourceB.reviewId]
  };
  const adjudicationObservation = {
    ...observation,
    nodes: [
      ...observation.nodes,
      node("price-alt", "card", "$13.00", 145, 190, 100, 35)
    ]
  };

  await page.route("**/api/queue", async (route) => {
    await route.fulfill({
      json: {
        queueId: "synthetic-adjudication-queue",
        queueType: "adjudication",
        mode: "adjudication",
        reviewerId: "reviewer-c",
        cohort: "training",
        labelVisibility: "independent reviews and disagreements visible",
        items: [
          {
            pageId: "synthetic-review-page",
            rootNodeId: "root",
            candidateCardNodeIds: ["card"],
            source: reviewTemplate.source,
            reviewTemplate: adjudicationTemplate,
            sourceReviews: [sourceA, sourceB],
            agreement: {
              disagreements: [
                { cardNodeId: "card", fields: ["currentPrice"] }
              ]
            },
            saved: false
          }
        ]
      }
    });
  });
  await page.route("**/api/observation?*", async (route) => {
    await route.fulfill({ json: adjudicationObservation });
  });
  await page.route("**/api/screenshot?*", async (route) => {
    await route.fulfill({
      contentType: "image/svg+xml",
      body: [
        '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800">',
        '<rect width="600" height="800" fill="#fff"/>',
        '<rect x="20" y="100" width="250" height="300" fill="#eef4ff" stroke="#1659c7"/>',
        '<text x="35" y="150" font-size="22">Coffee, 12 oz</text>',
        '<text x="35" y="215" font-size="22">$12.00 or $13.00</text>',
        "</svg>"
      ].join("")
    });
  });
  await page.route("**/api/candidates?*", async (route) => {
    await route.fulfill({
      json: {
        cardNodeId: "card",
        candidates: [
          {
            id: "price@p0",
            kind: "current-price",
            nodeId: "price",
            sourceText: "$12.00",
            cents: 1200
          },
          {
            id: "price-alt@p0",
            kind: "current-price",
            nodeId: "price-alt",
            sourceText: "$13.00",
            cents: 1300
          },
          {
            id: "quantity@q0",
            kind: "package-quantity",
            nodeId: "quantity",
            sourceText: "12 oz",
            valuePerPackage: 12,
            unit: "oz",
            dimension: "mass"
          }
        ]
      }
    });
  });
  await page.route("**/api/review", async (route) => {
    submittedReview = route.request().postDataJSON();
    await route.fulfill({ json: { valid: true } });
  });

  await page.goto("http://127.0.0.1:4173/review-workbench/");

  await expect(page.locator("#queueMeta")).toHaveText(
    "reviewer-c · training · adjudication"
  );
  await expect(
    page.getByRole("button", { name: "Submit adjudication" })
  ).toBeDisabled();
  await expect(page.locator("#sourceReviewSection")).toBeHidden();

  await page.getByRole("button", { name: "Review card 1 of 1" }).click();
  await expect(page.locator("#sourceReviewSection")).toBeVisible();
  await expect(page.locator("#disagreementSummary")).toHaveText(
    "Current price"
  );
  await expect(page.locator("#reviewALabel")).toContainText("reviewer-a");
  await expect(page.locator("#reviewBLabel")).toContainText("reviewer-b");
  await page.screenshot({
    path: testInfo.outputPath("adjudication-workbench.png"),
    fullPage: true
  });
  await page.getByRole("button", { name: "Use decision B" }).click();
  await expect(page.locator("#currentPrice")).toHaveValue("price-alt@p0");
  await expect(page.locator("#pointerPreview")).toHaveText(
    target("price-alt@p0")
  );

  await page.getByRole("button", { name: "Record decision" }).click();
  await expect(
    page.getByRole("button", { name: "Submit adjudication" })
  ).toBeEnabled();
  await page.getByRole("button", { name: "Submit adjudication" }).click();
  await expect(page.locator("#saveState")).toHaveText("Submitted");

  expect(submittedReview).toMatchObject({
    reviewId: "reviewer-c--synthetic-review-page",
    phase: "adjudicated",
    reviewerId: "reviewer-c",
    preannotationVisibility: "shown-after-submit",
    sourceReviewIds: [
      "reviewer-a--synthetic-review-page",
      "reviewer-b--synthetic-review-page"
    ],
    products: [
      {
        cardNodeId: "card",
        scope: "primary-results",
        target: target("price-alt@p0")
      }
    ]
  });
});

function target(priceCandidate: string) {
  return [
    "CARD card",
    "TITLE title",
    `CURRENT_PRICE ${priceCandidate}`,
    "NATIVE_UNIT_PRICE NONE",
    "PACKAGE_QUANTITY quantity@q0",
    "PACK_COUNT NONE",
    "STATUS comparable"
  ].join("\n");
}

function node(
  id: string,
  parentId: string | undefined,
  text: string | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  tag = "span"
) {
  return {
    id,
    ...(parentId ? { parentId } : {}),
    tag,
    ...(text ? { text } : {}),
    bounds: { x, y, width, height },
    intersectsViewport: true,
    interactive: false,
    style: {
      display: "block",
      position: "static",
      fontSize: 16,
      fontWeight: 400
    }
  };
}
