const state = {
  queue: null,
  item: null,
  observation: null,
  products: [],
  cardNodeId: null,
  nodeChoices: [],
  candidates: [],
  draftChallengeTags: []
};

const fields = {
  pageList: document.querySelector("#pageList"),
  pageTitle: document.querySelector("#pageTitle"),
  selectionHint: document.querySelector("#selectionHint"),
  queueMeta: document.querySelector("#queueMeta"),
  pageProgress: document.querySelector("#pageProgress"),
  captureStage: document.querySelector("#captureStage"),
  captureImage: document.querySelector("#captureImage"),
  captureOverlay: document.querySelector("#captureOverlay"),
  cardRoots: document.querySelector("#cardRoots"),
  nodeChoices: document.querySelector("#nodeChoices"),
  sourceReviewSection: document.querySelector("#sourceReviewSection"),
  disagreementSummary: document.querySelector("#disagreementSummary"),
  reviewALabel: document.querySelector("#reviewALabel"),
  reviewATarget: document.querySelector("#reviewATarget"),
  useReviewA: document.querySelector("#useReviewA"),
  reviewBLabel: document.querySelector("#reviewBLabel"),
  reviewBTarget: document.querySelector("#reviewBTarget"),
  useReviewB: document.querySelector("#useReviewB"),
  fieldEditor: document.querySelector("#fieldEditor"),
  titleChoices: document.querySelector("#titleChoices"),
  scope: document.querySelector("#scope"),
  currentPrice: document.querySelector("#currentPrice"),
  nativeUnitPrice: document.querySelector("#nativeUnitPrice"),
  packageQuantity: document.querySelector("#packageQuantity"),
  packCount: document.querySelector("#packCount"),
  status: document.querySelector("#status"),
  notes: document.querySelector("#notes"),
  pointerPreview: document.querySelector("#pointerPreview"),
  addProduct: document.querySelector("#addProduct"),
  products: document.querySelector("#products"),
  productCount: document.querySelector("#productCount"),
  submitReview: document.querySelector("#submitReview"),
  saveState: document.querySelector("#saveState"),
  clearSelection: document.querySelector("#clearSelection")
};

const statuses = [
  "comparable",
  "insufficient-evidence",
  "conditional-price",
  "price-range",
  "unselected-variant",
  "ambiguous-quantity",
  "unsupported-unit",
  "not-a-product"
];

const disagreementLabels = {
  root: "Card root",
  scope: "Scope",
  status: "Status",
  title: "Title",
  currentPrice: "Current price",
  nativeUnitPrice: "Native unit price",
  packageQuantity: "Package quantity",
  packCount: "Pack count",
  dimension: "Dimension"
};

await initialize();

async function initialize() {
  state.queue = await fetchJson("/api/queue");
  for (const item of state.queue.items) {
    item.draftCount = readDraftProducts(item).length;
  }
  const modeLabel =
    state.queue.mode === "adjudication" ? "adjudication" : "blinded";
  fields.queueMeta.textContent = `${state.queue.reviewerId} · ${state.queue.cohort} · ${modeLabel}`;
  if (state.queue.mode === "adjudication") {
    fields.submitReview.textContent = "Submit adjudication";
    fields.addProduct.textContent = "Record decision";
  }
  renderPageList();
  const first = state.queue.items.find((item) => !item.saved) ?? state.queue.items[0];
  if (first) await openPage(first.pageId);
}

function renderPageList() {
  fields.pageList.replaceChildren(
    ...state.queue.items.map((item) => {
      const button = element("button", "page-button");
      button.type = "button";
      button.dataset.pageId = item.pageId;
      const progress = item.saved
        ? "✓"
        : item.draftCount
          ? `${item.draftCount}`
          : "";
      button.append(
        element("span", "", item.pageId),
        element(
          "span",
          item.saved ? "saved-mark" : "draft-mark",
          progress
        )
      );
      if (!item.saved && item.draftCount) {
        button.title = `${item.draftCount} draft card decisions`;
      }
      button.addEventListener("click", () => openPage(item.pageId));
      return button;
    })
  );
  const saved = state.queue.items.filter((item) => item.saved).length;
  fields.pageProgress.textContent = `${saved}/${state.queue.items.length}`;
}

async function openPage(pageId) {
  state.item = state.queue.items.find((item) => item.pageId === pageId);
  state.observation = await fetchJson(
    `/api/observation?pageId=${encodeURIComponent(pageId)}`
  );
  state.products = state.item.saved ? [] : readDraftProducts(state.item);
  clearSelection();
  fields.pageTitle.textContent = pageId;
  fields.captureImage.src = `/api/screenshot?pageId=${encodeURIComponent(pageId)}`;
  document.querySelectorAll(".page-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.pageId === pageId);
  });
  renderProducts();
}

fields.captureImage.addEventListener("click", async (event) => {
  const rect = fields.captureImage.getBoundingClientRect();
  const scaleX = fields.captureImage.naturalWidth / rect.width;
  const scaleY = fields.captureImage.naturalHeight / rect.height;
  const root = nodeById(state.observation.rootNodeId);
  const documentX = root.bounds.x + (event.clientX - rect.left) * scaleX;
  const documentY = root.bounds.y + (event.clientY - rect.top) * scaleY;
  const candidateCardNodeIds = new Set(state.item.candidateCardNodeIds);
  state.nodeChoices = state.observation.nodes
    .filter((node) => candidateCardNodeIds.has(node.id))
    .filter((node) => contains(node.bounds, documentX, documentY))
    .sort((left, right) => area(left.bounds) - area(right.bounds))
    .slice(0, 4);
  renderNodeChoices();
});

fields.clearSelection.addEventListener("click", clearSelection);
fields.addProduct.addEventListener("click", addProduct);
fields.submitReview.addEventListener("click", submitReview);
fields.useReviewA.addEventListener("click", () => applySourceReview(0));
fields.useReviewB.addEventListener("click", () => applySourceReview(1));
for (const input of [
  fields.currentPrice,
  fields.nativeUnitPrice,
  fields.packageQuantity,
  fields.packCount
]) {
  input.addEventListener("change", renderPointer);
}
fields.status.addEventListener("change", () => {
  if (fields.status.value && fields.status.value !== "comparable") {
    clearValueSelections();
  }
  renderPointer();
});
fields.scope.addEventListener("change", () => {
  if (fields.scope.value === "non-product") {
    fields.status.value = "not-a-product";
    clearValueSelections();
  } else if (fields.status.value === "not-a-product") {
    fields.status.value = "";
  }
  renderPointer();
});

function renderNodeChoices() {
  if (state.nodeChoices.length === 0) {
    fields.nodeChoices.className = "choice-list empty-state";
    fields.nodeChoices.textContent = "No observed node contains that point.";
    return;
  }
  fields.nodeChoices.className = "choice-list";
  fields.nodeChoices.replaceChildren(
    ...state.nodeChoices.map((node) => {
      const button = element("button", "choice-button");
      button.type = "button";
      button.append(
        element("strong", "", `${node.id} · ${node.tag}`),
        element("span", "", node.text || node.accessibleName || "(no direct text)")
      );
      button.addEventListener("click", () => selectCard(node.id));
      return button;
    })
  );
}

async function selectCard(cardNodeId) {
  state.cardNodeId = cardNodeId;
  const cardIndex = state.item.candidateCardNodeIds.indexOf(cardNodeId);
  fields.selectionHint.textContent = `Card ${cardIndex + 1} selected`;
  state.candidates = (
    await fetchJson(
      `/api/candidates?pageId=${encodeURIComponent(
        state.item.pageId
      )}&cardNodeId=${encodeURIComponent(cardNodeId)}`
    )
  ).candidates;
  fields.fieldEditor.hidden = false;
  document.querySelectorAll(".choice-button").forEach((button) => {
    button.classList.toggle(
      "active",
      button.querySelector("strong")?.textContent?.startsWith(`${cardNodeId} ·`)
    );
  });
  document.querySelectorAll(".card-root-button").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.cardNodeId === cardNodeId
    );
  });
  renderCardFields();
  await ensureCaptureImage();
  highlightNode(nodeById(cardNodeId));
  revealNode(nodeById(cardNodeId));
}

function renderCardFields() {
  const descendants = state.observation.nodes
    .filter(
      (node) =>
        node.id === state.cardNodeId ||
        isDescendant(node.id, state.cardNodeId)
    )
    .map((node) => ({ node, content: nodeContent(node) }))
    .filter(({ content }) => content.length > 1)
    .sort((left, right) => area(right.node.bounds) - area(left.node.bounds))
    .slice(0, 60);
  fields.titleChoices.replaceChildren(
    ...descendants.map(({ node, content }) => {
      const label = element("label", "title-choice");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = node.id;
      checkbox.addEventListener("change", renderPointer);
      label.append(checkbox, element("span", "", `${node.id} · ${content}`));
      return label;
    })
  );
  fillCandidateSelect(fields.currentPrice, "current-price");
  fillCandidateSelect(fields.nativeUnitPrice, "native-unit-price");
  fillCandidateSelect(fields.packageQuantity, "package-quantity");
  fillCandidateSelect(fields.packCount, "pack-count");
  fields.status.replaceChildren(
    option("", "Choose status"),
    ...statuses.map((status) => option(status, status))
  );
  fields.scope.value = "primary-results";
  fields.status.value = "";
  fields.notes.value = "";
  state.draftChallengeTags = [];
  renderSourceReviews();
  const existing = state.products.find(
    (product) => product.cardNodeId === state.cardNodeId
  );
  if (existing) applyProduct(existing);
  else renderPointer();
}

function renderSourceReviews() {
  if (state.queue.mode !== "adjudication" || !state.cardNodeId) {
    fields.sourceReviewSection.hidden = true;
    return;
  }
  const products = state.item.sourceReviews.map((review) =>
    review.products.find((product) => product.cardNodeId === state.cardNodeId)
  );
  const disagreement = state.item.agreement.disagreements.find(
    (item) => item.cardNodeId === state.cardNodeId
  );
  fields.sourceReviewSection.hidden = false;
  fields.disagreementSummary.textContent = disagreement
    ? disagreement.fields
        .map((field) => disagreementLabels[field] || field)
        .join(", ")
    : "Exact agreement";
  renderSourceReview(0, products[0]);
  renderSourceReview(1, products[1]);
}

function renderSourceReview(index, product) {
  const review = state.item.sourceReviews[index];
  const label = index === 0 ? fields.reviewALabel : fields.reviewBLabel;
  const target = index === 0 ? fields.reviewATarget : fields.reviewBTarget;
  const button = index === 0 ? fields.useReviewA : fields.useReviewB;
  if (!product) {
    label.textContent = review.reviewerId;
    target.textContent = "Missing decision";
    button.disabled = true;
    return;
  }
  label.textContent = `${review.reviewerId} · ${product.scope}`;
  target.textContent = product.target;
  button.disabled = !product;
}

function applySourceReview(index) {
  const product = state.item.sourceReviews[index].products.find(
    (candidate) => candidate.cardNodeId === state.cardNodeId
  );
  if (!product) return;
  applyProduct(product);
}

function applyProduct(product) {
  const pointer = new Map(
    product.target.split("\n").map((line) => {
      const separator = line.indexOf(" ");
      return [line.slice(0, separator), line.slice(separator + 1)];
    })
  );
  const titleNodeIds =
    pointer.get("TITLE") === "NONE"
      ? []
      : (pointer.get("TITLE") || "").split(",");
  fields.titleChoices.querySelectorAll("input").forEach((input) => {
    input.checked = titleNodeIds.includes(input.value);
  });
  fields.scope.value = product.scope;
  setSelectValue(fields.currentPrice, pointer.get("CURRENT_PRICE"));
  setSelectValue(fields.nativeUnitPrice, pointer.get("NATIVE_UNIT_PRICE"));
  setSelectValue(fields.packageQuantity, pointer.get("PACKAGE_QUANTITY"));
  setSelectValue(fields.packCount, pointer.get("PACK_COUNT"));
  setSelectValue(fields.status, pointer.get("STATUS"));
  fields.notes.value = product.notes || "";
  state.draftChallengeTags = [...(product.challengeTags || [])];
  renderPointer();
}

function setSelectValue(select, value) {
  if ([...select.options].some((candidate) => candidate.value === value)) {
    select.value = value;
  }
}

function fillCandidateSelect(select, kind) {
  const candidates = state.candidates.filter((candidate) => candidate.kind === kind);
  select.replaceChildren(
    option("NONE", "None"),
    ...candidates.map((candidate) =>
      option(
        candidate.id,
        `${candidate.id} · ${candidate.sourceText} · ${candidateSummary(candidate)}`
      )
    )
  );
}

function candidateSummary(candidate) {
  if ("cents" in candidate) return `$${(candidate.cents / 100).toFixed(2)}`;
  if ("centsPerUnit" in candidate) {
    return `${candidate.centsPerUnit}¢/${candidate.unit}`;
  }
  if ("valuePerPackage" in candidate) {
    return `${candidate.valuePerPackage} ${candidate.unit}`;
  }
  return `${candidate.packCount} pack`;
}

function pointerValue() {
  const titles = [...fields.titleChoices.querySelectorAll("input:checked")].map(
    (input) => input.value
  );
  return [
    `CARD ${state.cardNodeId}`,
    `TITLE ${titles.length ? titles.join(",") : "NONE"}`,
    `CURRENT_PRICE ${fields.currentPrice.value}`,
    `NATIVE_UNIT_PRICE ${fields.nativeUnitPrice.value}`,
    `PACKAGE_QUANTITY ${fields.packageQuantity.value}`,
    `PACK_COUNT ${fields.packCount.value}`,
    `STATUS ${fields.status.value}`
  ].join("\n");
}

function renderPointer() {
  fields.pointerPreview.textContent = state.cardNodeId ? pointerValue() : "";
  const hasTitle =
    fields.titleChoices.querySelectorAll("input:checked").length > 0;
  fields.addProduct.disabled =
    !state.cardNodeId || !hasTitle || !pointerFieldsAreComplete();
}

async function addProduct() {
  const product = {
    cardNodeId: state.cardNodeId,
    scope: fields.scope.value,
    target: pointerValue(),
    ...(state.draftChallengeTags.length
      ? { challengeTags: state.draftChallengeTags }
      : {}),
    ...(fields.notes.value.trim() ? { notes: fields.notes.value.trim() } : {})
  };
  const existing = state.products.findIndex(
    (candidate) => candidate.cardNodeId === product.cardNodeId
  );
  if (existing >= 0) state.products.splice(existing, 1, product);
  else state.products.push(product);
  persistDraft();
  renderProducts();
  const reviewed = new Set(state.products.map((candidate) => candidate.cardNodeId));
  const next = state.item.candidateCardNodeIds.find(
    (cardNodeId) => !reviewed.has(cardNodeId)
  );
  if (next) await selectCard(next);
  else clearSelection();
}

function renderProducts() {
  const total = state.item?.candidateCardNodeIds.length ?? 0;
  const reviewed = state.products.length;
  fields.productCount.textContent = `${reviewed}/${total} cards`;
  renderCardRoots();
  const complete = total > 0 && reviewed === total;
  fields.submitReview.disabled = Boolean(state.item?.saved) || !complete;
  fields.saveState.textContent = state.item?.saved
    ? "Already submitted"
    : `${reviewed}/${total} reviewed`;
  if (state.products.length === 0) {
    fields.products.className = "product-list empty-state";
    fields.products.textContent = "No products added.";
    return;
  }
  fields.products.className = "product-list";
  fields.products.replaceChildren(
    ...state.products.map((product) => {
      const row = element("div", "product-row");
      const summary = document.createElement("div");
      summary.append(
        element("strong", "", product.cardNodeId),
        element("span", "", product.target.split("\n").at(-1))
      );
      const remove = element("button", "remove-product", "×");
      remove.type = "button";
      remove.title = "Remove product";
      remove.addEventListener("click", () => {
        state.products = state.products.filter(
          (candidate) => candidate.cardNodeId !== product.cardNodeId
        );
        persistDraft();
        renderProducts();
      });
      row.append(summary, remove);
      return row;
    })
  );
}

async function submitReview() {
  if (state.products.length !== state.item.candidateCardNodeIds.length) {
    fields.saveState.textContent = "Complete every card before submitting";
    return;
  }
  fields.submitReview.disabled = true;
  fields.saveState.textContent = "Validating";
  const review = {
    ...state.item.reviewTemplate,
    completedAt: new Date().toISOString(),
    products: state.products
  };
  const response = await fetch("/api/review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(review)
  });
  const result = await response.json();
  if (!response.ok) {
    fields.saveState.textContent = (result.errors || [result.error]).join("; ");
    fields.submitReview.disabled = false;
    return;
  }
  state.item.saved = true;
  state.item.draftCount = 0;
  localStorage.removeItem(draftKey(state.item));
  fields.saveState.textContent = "Submitted";
  renderPageList();
}

function pointerFieldsAreComplete() {
  const status = fields.status.value;
  if (!status) return false;
  const currentPrice = fields.currentPrice.value !== "NONE";
  const nativeUnitPrice = fields.nativeUnitPrice.value !== "NONE";
  const packageQuantity = fields.packageQuantity.value !== "NONE";
  const packCount = fields.packCount.value !== "NONE";
  if (packCount && !packageQuantity) return false;
  if (status === "comparable") {
    return (
      fields.scope.value !== "non-product" &&
      (nativeUnitPrice || (currentPrice && packageQuantity))
    );
  }
  return (
    !currentPrice &&
    !nativeUnitPrice &&
    !packageQuantity &&
    !packCount &&
    (status !== "not-a-product" || fields.scope.value === "non-product")
  );
}

function clearValueSelections() {
  fields.currentPrice.value = "NONE";
  fields.nativeUnitPrice.value = "NONE";
  fields.packageQuantity.value = "NONE";
  fields.packCount.value = "NONE";
}

function draftKey(item) {
  return [
    "evidence-review-draft-v1",
    state.queue.queueId,
    item.reviewTemplate.reviewId,
    item.source.observationSha256
  ].join(":");
}

function readDraftProducts(item) {
  try {
    const raw = localStorage.getItem(draftKey(item));
    if (!raw) return [];
    const draft = JSON.parse(raw);
    if (
      draft.version !== 1 ||
      draft.queueId !== state.queue.queueId ||
      draft.reviewId !== item.reviewTemplate.reviewId ||
      draft.observationSha256 !== item.source.observationSha256 ||
      !Array.isArray(draft.products)
    ) {
      return [];
    }
    const expectedCards = new Set(item.candidateCardNodeIds);
    const seenCards = new Set();
    return draft.products.filter((product) => {
      if (
        !product ||
        typeof product !== "object" ||
        !expectedCards.has(product.cardNodeId) ||
        seenCards.has(product.cardNodeId) ||
        typeof product.target !== "string" ||
        !product.target.startsWith(`CARD ${product.cardNodeId}\n`)
      ) {
        return false;
      }
      seenCards.add(product.cardNodeId);
      return true;
    });
  } catch {
    return [];
  }
}

function persistDraft() {
  if (!state.item || state.item.saved) return;
  state.item.draftCount = state.products.length;
  if (state.products.length === 0) {
    localStorage.removeItem(draftKey(state.item));
  } else {
    localStorage.setItem(
      draftKey(state.item),
      JSON.stringify({
        version: 1,
        queueId: state.queue.queueId,
        reviewId: state.item.reviewTemplate.reviewId,
        observationSha256: state.item.source.observationSha256,
        products: state.products
      })
    );
  }
  renderPageList();
}

function clearSelection() {
  state.cardNodeId = null;
  state.nodeChoices = [];
  state.candidates = [];
  fields.nodeChoices.className = "choice-list empty-state";
  fields.nodeChoices.textContent = "None";
  fields.fieldEditor.hidden = true;
  fields.sourceReviewSection.hidden = true;
  fields.captureOverlay.style.display = "none";
  fields.selectionHint.textContent = "No card selected";
  document.querySelectorAll(".card-root-button").forEach((button) => {
    button.classList.remove("active");
  });
}

function renderCardRoots() {
  if (!state.item || !state.observation) {
    fields.cardRoots.replaceChildren();
    return;
  }
  const reviewed = new Set(state.products.map((product) => product.cardNodeId));
  fields.cardRoots.replaceChildren(
    ...state.item.candidateCardNodeIds.map((cardNodeId, index) => {
      const node = nodeById(cardNodeId);
      const button = element("button", "card-root-button");
      button.type = "button";
      button.dataset.cardNodeId = cardNodeId;
      button.classList.toggle("reviewed", reviewed.has(cardNodeId));
      button.classList.toggle("active", state.cardNodeId === cardNodeId);
      button.classList.toggle(
        "disputed",
        Boolean(
          state.item.agreement?.disagreements.some(
            (item) => item.cardNodeId === cardNodeId
          )
        )
      );
      button.setAttribute(
        "aria-label",
        `Review card ${index + 1} of ${state.item.candidateCardNodeIds.length}`
      );
      button.append(
        element("strong", "", String(index + 1)),
        element("span", "", cardNodeId)
      );
      button.addEventListener("click", () => selectCard(cardNodeId));
      return button;
    })
  );
}

function highlightNode(node) {
  const imageRect = fields.captureImage.getBoundingClientRect();
  const stageRect = fields.captureStage.getBoundingClientRect();
  const root = nodeById(state.observation.rootNodeId);
  const scaleX = imageRect.width / fields.captureImage.naturalWidth;
  const scaleY = imageRect.height / fields.captureImage.naturalHeight;
  Object.assign(fields.captureOverlay.style, {
    display: "block",
    left: `${imageRect.left - stageRect.left + fields.captureStage.scrollLeft +
      (node.bounds.x - root.bounds.x) * scaleX}px`,
    top: `${imageRect.top - stageRect.top + fields.captureStage.scrollTop +
      (node.bounds.y - root.bounds.y) * scaleY}px`,
    width: `${node.bounds.width * scaleX}px`,
    height: `${node.bounds.height * scaleY}px`
  });
}

function revealNode(node) {
  const imageRect = fields.captureImage.getBoundingClientRect();
  const root = nodeById(state.observation.rootNodeId);
  const scaleY = imageRect.height / fields.captureImage.naturalHeight;
  const targetTop =
    fields.captureImage.offsetTop + (node.bounds.y - root.bounds.y) * scaleY;
  fields.captureStage.scrollTo({
    top: Math.max(0, targetTop - 24),
    behavior: "smooth"
  });
}

async function ensureCaptureImage() {
  if (fields.captureImage.complete && fields.captureImage.naturalWidth > 0) {
    return;
  }
  await new Promise((resolve) => {
    fields.captureImage.addEventListener("load", resolve, { once: true });
    fields.captureImage.addEventListener("error", resolve, { once: true });
  });
}

function nodeById(nodeId) {
  return state.observation.nodes.find((node) => node.id === nodeId);
}

function isDescendant(nodeId, ancestorId) {
  let node = nodeById(nodeId);
  while (node?.parentId) {
    if (node.parentId === ancestorId) return true;
    node = nodeById(node.parentId);
  }
  return false;
}

function contains(bounds, x, y) {
  return (
    x >= bounds.x &&
    x <= bounds.x + bounds.width &&
    y >= bounds.y &&
    y <= bounds.y + bounds.height
  );
}

function area(bounds) {
  return bounds.width * bounds.height;
}

function nodeContent(node) {
  return [
    node.text,
    node.accessibleName,
    node.attributes?.ariaLabel,
    node.attributes?.alt,
    node.attributes?.title
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(" | ")
    .replace(/\s+/g, " ")
    .trim();
}

function option(value, label) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}

function element(tag, className = "", text = "") {
  const item = document.createElement(tag);
  item.className = className;
  item.textContent = text;
  return item;
}

async function fetchJson(url) {
  const response = await fetch(url);
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || `Request failed: ${response.status}`);
  return value;
}
