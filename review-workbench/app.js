const state = {
  queue: null,
  item: null,
  observation: null,
  products: [],
  cardNodeId: null,
  nodeChoices: [],
  candidates: []
};

const fields = {
  pageList: document.querySelector("#pageList"),
  pageTitle: document.querySelector("#pageTitle"),
  queueMeta: document.querySelector("#queueMeta"),
  pageProgress: document.querySelector("#pageProgress"),
  captureStage: document.querySelector("#captureStage"),
  captureImage: document.querySelector("#captureImage"),
  captureOverlay: document.querySelector("#captureOverlay"),
  nodeChoices: document.querySelector("#nodeChoices"),
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

await initialize();

async function initialize() {
  state.queue = await fetchJson("/api/queue");
  fields.queueMeta.textContent = `${state.queue.reviewerId} · ${state.queue.cohort} · blinded`;
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
      button.append(
        element("span", "", item.pageId),
        element("span", "saved-mark", item.saved ? "✓" : "")
      );
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
  state.products = [];
  clearSelection();
  fields.pageTitle.textContent = pageId;
  fields.captureImage.src = `/api/screenshot?pageId=${encodeURIComponent(pageId)}`;
  fields.saveState.textContent = state.item.saved ? "Already submitted" : "Not submitted";
  fields.submitReview.disabled = state.item.saved;
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
for (const input of [
  fields.currentPrice,
  fields.nativeUnitPrice,
  fields.packageQuantity,
  fields.packCount,
  fields.status
]) {
  input.addEventListener("change", renderPointer);
}
fields.scope.addEventListener("change", () => {
  if (fields.scope.value === "non-product") fields.status.value = "not-a-product";
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
  renderCardFields();
  highlightNode(nodeById(cardNodeId));
}

function renderCardFields() {
  const descendants = state.observation.nodes
    .filter((node) => node.text && isDescendant(node.id, state.cardNodeId))
    .filter((node) => node.text.trim().length > 1)
    .sort((left, right) => area(right.bounds) - area(left.bounds))
    .slice(0, 40);
  fields.titleChoices.replaceChildren(
    ...descendants.map((node) => {
      const label = element("label", "title-choice");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = node.id;
      checkbox.addEventListener("change", renderPointer);
      label.append(checkbox, element("span", "", `${node.id} · ${node.text}`));
      return label;
    })
  );
  fillCandidateSelect(fields.currentPrice, "current-price");
  fillCandidateSelect(fields.nativeUnitPrice, "native-unit-price");
  fillCandidateSelect(fields.packageQuantity, "package-quantity");
  fillCandidateSelect(fields.packCount, "pack-count");
  fields.status.replaceChildren(
    ...statuses.map((status) => option(status, status))
  );
  fields.scope.value = "primary-results";
  fields.status.value = "comparable";
  fields.notes.value = "";
  renderPointer();
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
  fields.addProduct.disabled = !state.cardNodeId || !hasTitle;
}

function addProduct() {
  const product = {
    cardNodeId: state.cardNodeId,
    scope: fields.scope.value,
    target: pointerValue(),
    ...(fields.notes.value.trim() ? { notes: fields.notes.value.trim() } : {})
  };
  const existing = state.products.findIndex(
    (candidate) => candidate.cardNodeId === product.cardNodeId
  );
  if (existing >= 0) state.products.splice(existing, 1, product);
  else state.products.push(product);
  renderProducts();
  clearSelection();
}

function renderProducts() {
  fields.productCount.textContent = `${state.products.length} products`;
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
        renderProducts();
      });
      row.append(summary, remove);
      return row;
    })
  );
}

async function submitReview() {
  if (state.products.length === 0) {
    fields.saveState.textContent = "Add at least one reviewed product";
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
  fields.saveState.textContent = "Submitted";
  renderPageList();
}

function clearSelection() {
  state.cardNodeId = null;
  state.nodeChoices = [];
  state.candidates = [];
  fields.nodeChoices.className = "choice-list empty-state";
  fields.nodeChoices.textContent = "Select a point in the capture.";
  fields.fieldEditor.hidden = true;
  fields.captureOverlay.style.display = "none";
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
