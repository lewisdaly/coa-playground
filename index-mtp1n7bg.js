// tigerbeetle-wasm/zig-out/bin/tigerbeetle.wasm
var tigerbeetle_default = "./tigerbeetle-qrh0bf32.wasm";

// src/playground/model.ts
function createEmptyModel() {
  return {
    ledgers: [],
    cases: []
  };
}
function createEmptyCase(name) {
  return {
    name,
    description: [],
    accounts: [],
    batches: []
  };
}
function createEmptyBatch(index) {
  return {
    index,
    description: [],
    transfers: []
  };
}

// src/playground/parser.ts
function parsePlaygroundCode(code) {
  const model = createEmptyModel();
  const lines = code.split(`
`);
  model.ledgers = parseLedgers(code);
  model.cases = parseCases(code, lines);
  return model;
}
function parseLedgers(code) {
  const ledgers = [];
  const regex = /const\s+(\w+)\s*=\s*defineLedger\s*\(\s*"([^"]+)"\s*,\s*(\d+)(?:\s*,\s*(\d+))?\s*\)/g;
  let match;
  while ((match = regex.exec(code)) !== null) {
    const ledger = {
      name: match[2],
      id: parseInt(match[3], 10)
    };
    if (match[4] !== undefined) {
      ledger.assetScale = parseInt(match[4], 10);
    }
    ledgers.push(ledger);
  }
  return ledgers;
}
function parseCases(code, lines) {
  const cases = [];
  const funcRegex = /^async\s+function\s+(\w+)\s*\(\s*\)\s*\{/gm;
  let match;
  while ((match = funcRegex.exec(code)) !== null) {
    const funcName = match[1];
    const startIndex = match.index;
    const startLine = code.substring(0, startIndex).split(`
`).length;
    const funcBody = extractFunctionBody(code, startIndex + match[0].length - 1);
    if (!funcBody)
      continue;
    const caseModel = createEmptyCase(funcName);
    caseModel.description = extractPrecedingComments(lines, startLine - 1);
    parseCaseBody(funcBody, caseModel);
    caseModel.lineRange = [startLine, startLine + funcBody.split(`
`).length];
    cases.push(caseModel);
  }
  return cases;
}
function extractPrecedingComments(lines, lineIndex) {
  const comments = [];
  let i = lineIndex - 1;
  while (i >= 0) {
    const line = lines[i].trim();
    if (line.startsWith("//")) {
      let text = line.replace(/^\/\/\s*/, "");
      if (!/^─+\s*.*\s*─+$/.test(text) && text.length > 0) {
        comments.unshift(text);
      }
      i--;
    } else if (line === "") {
      i--;
    } else {
      break;
    }
  }
  return comments;
}
function extractFunctionBody(code, openBraceIndex) {
  let depth = 0;
  let start = openBraceIndex;
  for (let i = openBraceIndex;i < code.length; i++) {
    const char = code[i];
    if (char === "{")
      depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) {
        return code.substring(start, i + 1);
      }
    }
  }
  return null;
}
function parseCaseBody(body, caseModel) {
  const resetMatch = body.match(/resetAccountRegistry\s*\(\s*(\d+)n/);
  if (resetMatch) {
    caseModel.startId = resetMatch[1];
  }
  caseModel.accounts = parseAccounts(body);
  caseModel.batches = parseBatches(body);
}
function parseAccounts(body) {
  const accounts = [];
  const createAccountsMatch = body.match(/(?:await\s+)?ctx\.createAccounts\s*\(\s*\[/);
  if (!createAccountsMatch)
    return accounts;
  const startIdx = createAccountsMatch.index + createAccountsMatch[0].length;
  let depth = 1;
  let endIdx = startIdx;
  for (let i = startIdx;i < body.length && depth > 0; i++) {
    if (body[i] === "[")
      depth++;
    else if (body[i] === "]")
      depth--;
    endIdx = i;
  }
  const accountsStr = body.substring(startIdx, endIdx);
  const accountRegex = /account\s*\(\s*\{([^}]+)\}\s*\)/g;
  let match;
  while ((match = accountRegex.exec(accountsStr)) !== null) {
    const props = match[1];
    const account = parseAccountProps(props);
    if (account)
      accounts.push(account);
  }
  return accounts;
}
function parseAccountProps(props) {
  const nameMatch = props.match(/name\s*:\s*"([^"]+)"/);
  const ledgerMatch = props.match(/ledger\s*:\s*(\w+)/);
  const typeMatch = props.match(/type\s*:\s*"(\w+)"/);
  const flagsMatch = props.match(/flags\s*:\s*"([^"]*)"/);
  if (!nameMatch || !ledgerMatch || !typeMatch)
    return null;
  return {
    name: nameMatch[1],
    ledger: ledgerMatch[1],
    type: typeMatch[1],
    flags: flagsMatch ? flagsMatch[1].split("|").map((f) => f.trim()).filter(Boolean) : []
  };
}
function parseBatches(body) {
  const batches = [];
  const batchRegex = /(?:await\s+)?ctx\.batch\s*\(\s*(\d+)\s*,/g;
  let match;
  while ((match = batchRegex.exec(body)) !== null) {
    const batchIndex = parseInt(match[1], 10);
    const afterIndexPos = match.index + match[0].length;
    const descResult = parseDescription(body, afterIndexPos);
    if (!descResult)
      continue;
    const transfersResult = parseTransfersArray(body, descResult.endPos);
    if (!transfersResult)
      continue;
    batches.push({
      index: batchIndex,
      description: descResult.description,
      transfers: transfersResult.transfers
    });
  }
  return batches;
}
function parseDescription(body, startPos) {
  let pos = startPos;
  while (pos < body.length && /\s/.test(body[pos]))
    pos++;
  if (body[pos] === '"') {
    const endQuote = body.indexOf('"', pos + 1);
    if (endQuote === -1)
      return null;
    const desc = body.substring(pos + 1, endQuote);
    let commaPos = endQuote + 1;
    while (commaPos < body.length && body[commaPos] !== ",")
      commaPos++;
    return { description: [desc], endPos: commaPos + 1 };
  } else if (body[pos] === "[") {
    let depth = 1;
    let endPos = pos + 1;
    while (endPos < body.length && depth > 0) {
      if (body[endPos] === "[")
        depth++;
      else if (body[endPos] === "]")
        depth--;
      endPos++;
    }
    const arrStr = body.substring(pos + 1, endPos - 1);
    const strings = arrStr.match(/"([^"]+)"/g)?.map((s) => s.slice(1, -1)) ?? [];
    let commaPos = endPos;
    while (commaPos < body.length && body[commaPos] !== ",")
      commaPos++;
    return { description: strings, endPos: commaPos + 1 };
  }
  return null;
}
function parseTransfersArray(body, startPos) {
  let pos = startPos;
  while (pos < body.length && /\s/.test(body[pos]))
    pos++;
  if (body[pos] !== "[")
    return null;
  let depth = 1;
  let endPos = pos + 1;
  while (endPos < body.length && depth > 0) {
    if (body[endPos] === "[")
      depth++;
    else if (body[endPos] === "]")
      depth--;
    endPos++;
  }
  const arrStr = body.substring(pos + 1, endPos - 1);
  const transfers = parseTransferCalls(arrStr);
  return { transfers, endPos };
}
function parseTransferCalls(arrStr) {
  const transfers = [];
  const transferRegex = /transfer\s*\(([^)]+(?:\{[^}]*\}[^)]*)?)\)/g;
  let match;
  while ((match = transferRegex.exec(arrStr)) !== null) {
    const transfer = parseTransferArgs(match[1]);
    if (transfer)
      transfers.push(transfer);
  }
  return transfers;
}
function parseTransferArgs(argsStr) {
  const parts = [];
  let current = "";
  let depth = 0;
  for (const char of argsStr) {
    if (char === "{")
      depth++;
    else if (char === "}")
      depth--;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim())
    parts.push(current.trim());
  if (parts.length < 5)
    return null;
  const id = parts[0].replace(/n$/, "");
  const ledger = parts[1];
  const amount = parts[2].replace(/n$/, "");
  const debitAccount = parts[3].replace(/^"|"$/g, "");
  const creditAccount = parts[4].replace(/^"|"$/g, "");
  let flags = "";
  if (parts.length > 5 && !parts[5].startsWith("{")) {
    flags = parts[5].replace(/^"|"$/g, "");
  }
  let pendingId;
  let failsWith;
  const optionsIdx = parts.findIndex((p) => p.startsWith("{"));
  if (optionsIdx !== -1) {
    const optionsStr = parts[optionsIdx];
    const pendingIdMatch = optionsStr.match(/pending_id\s*:\s*(\d+)n?/);
    if (pendingIdMatch)
      pendingId = pendingIdMatch[1];
    const failsWithMatch = optionsStr.match(/failsWith\s*:\s*"([^"]+)"/);
    if (failsWithMatch)
      failsWith = failsWithMatch[1];
  }
  return {
    id,
    ledger,
    amount,
    debitAccount,
    creditAccount,
    flags,
    pendingId,
    failsWith
  };
}

// src/playground/codegen-simple.ts
function generatePlaygroundCode(model) {
  const parts = [];
  if (model.ledgers.length > 0) {
    parts.push("// Define ledgers");
    for (const ledger of model.ledgers) {
      parts.push(generateLedger(ledger));
    }
    parts.push("");
  }
  for (const caseModel of model.cases) {
    parts.push(generateCase(caseModel));
    parts.push("");
  }
  if (model.cases.length > 0) {
    parts.push("// ─── Run cases ──────────────────────────────────────────────────────────────");
    parts.push("// Comment/uncomment to run specific cases:");
    for (let i = 0;i < model.cases.length; i++) {
      const prefix = i === 0 ? "" : "// ";
      parts.push(`${prefix}await ${model.cases[i].name}();`);
    }
  }
  return parts.join(`
`);
}
function generateLedger(ledger) {
  if (ledger.assetScale && ledger.assetScale > 0) {
    return `const ${ledger.name} = defineLedger("${ledger.name}", ${ledger.id}, ${ledger.assetScale});`;
  }
  return `const ${ledger.name} = defineLedger("${ledger.name}", ${ledger.id});`;
}
function generateCase(caseModel) {
  const parts = [];
  const headerLine = `// ─── ${formatCaseName(caseModel.name)} ${"─".repeat(Math.max(0, 60 - formatCaseName(caseModel.name).length))}`;
  parts.push(headerLine);
  for (const desc of caseModel.description) {
    parts.push(`// ${desc}`);
  }
  parts.push(`async function ${caseModel.name}() {`);
  const startId = caseModel.startId ?? "10000";
  parts.push(`  resetAccountRegistry(${startId}n, "${caseModel.name}");`);
  parts.push(`  const ctx = new CaseContext();`);
  parts.push("");
  if (caseModel.accounts.length > 0) {
    parts.push("  await ctx.createAccounts([");
    for (const account of caseModel.accounts) {
      parts.push(`    ${generateAccount(account)},`);
    }
    parts.push("  ]);");
    parts.push("");
  }
  for (const batch of caseModel.batches) {
    parts.push(generateBatch(batch));
    parts.push("");
  }
  parts.push("}");
  return parts.join(`
`);
}
function formatCaseName(name) {
  const match = name.match(/^case(\d+)_(\d+)$/);
  if (match) {
    return `Case ${match[1]}-${match[2]}`;
  }
  return name;
}
function generateAccount(account) {
  const flags = account.flags.length > 0 ? account.flags.join(" | ") : "";
  return `account({ name: "${account.name}", ledger: ${account.ledger}, type: "${account.type}", flags: "${flags}" })`;
}
function generateBatch(batch) {
  const parts = [];
  const firstDesc = batch.description[0] ?? `Batch ${batch.index}`;
  parts.push(`  // Batch ${batch.index}: ${firstDesc}`);
  let descArg;
  if (batch.description.length === 0) {
    descArg = '""';
  } else if (batch.description.length === 1) {
    descArg = `"${escapeString(batch.description[0])}"`;
  } else {
    const descLines = batch.description.map((d) => `    "${escapeString(d)}",`).join(`
`);
    descArg = `[
${descLines}
  ]`;
  }
  const transferLines = batch.transfers.map((t) => `    ${generateTransfer(t)},`).join(`
`);
  parts.push(`  await ctx.batch(${batch.index}, ${descArg}, [`);
  if (batch.transfers.length > 0) {
    for (const transfer of batch.transfers) {
      parts.push(`    ${generateTransfer(transfer)},`);
    }
  }
  parts.push("  ]);");
  return parts.join(`
`);
}
function generateTransfer(transfer) {
  const args = [
    `${transfer.id}n`,
    transfer.ledger,
    `${transfer.amount}n`,
    `"${transfer.debitAccount}"`,
    `"${transfer.creditAccount}"`
  ];
  if (transfer.flags || transfer.pendingId || transfer.failsWith) {
    args.push(`"${transfer.flags ?? ""}"`);
  }
  if (transfer.pendingId || transfer.failsWith) {
    const opts = [];
    if (transfer.pendingId) {
      opts.push(`pending_id: ${transfer.pendingId}n`);
    }
    if (transfer.failsWith) {
      opts.push(`failsWith: "${transfer.failsWith}"`);
    }
    args.push(`{ ${opts.join(", ")} }`);
  }
  return `transfer(${args.join(", ")})`;
}
function escapeString(s) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

// src/playground/simple-ui.ts
var ACCOUNT_TYPES = ["Asset", "Liability", "Equity", "Income", "Expense"];
var ACCOUNT_FLAGS = [
  { value: "debits_must_not_exceed_credits", label: "debits_must_not_exceed_credits", short: "dr≤cr" },
  { value: "credits_must_not_exceed_debits", label: "credits_must_not_exceed_debits", short: "cr≤dr" },
  { value: "history", label: "history", short: "hist" }
];
var TRANSFER_FLAGS_MULTI = [
  { value: "linked", label: "linked", short: "link" },
  { value: "pending", label: "pending", short: "pend" },
  { value: "post_pending_transfer", label: "post_pending_transfer", short: "post" },
  { value: "void_pending_transfer", label: "void_pending_transfer", short: "void" },
  { value: "balancing_debit", label: "balancing_debit", short: "bal_dr" },
  { value: "balancing_credit", label: "balancing_credit", short: "bal_cr" },
  { value: "closing_debit", label: "closing_debit", short: "cls_dr" },
  { value: "closing_credit", label: "closing_credit", short: "cls_cr" }
];

class SimpleUI {
  container;
  model;
  selectedCaseIndex = 0;
  onChange;
  constructor(container, onChange) {
    this.container = container;
    this.onChange = onChange;
    this.model = { ledgers: [], cases: [] };
  }
  setModel(model) {
    this.model = model;
    if (this.selectedCaseIndex >= this.model.cases.length) {
      this.selectedCaseIndex = Math.max(0, this.model.cases.length - 1);
    }
    this.render();
  }
  getModel() {
    return this.model;
  }
  emitChange() {
    this.onChange(this.model);
  }
  render() {
    this.container.innerHTML = "";
    this.container.appendChild(this.renderLedgersSection());
    this.container.appendChild(this.renderCaseSelector());
    const selectedCase = this.model.cases[this.selectedCaseIndex];
    if (selectedCase) {
      this.container.appendChild(this.renderAccountsSection(selectedCase));
      this.container.appendChild(this.renderBatchesSection(selectedCase));
    } else if (this.model.cases.length === 0) {
      const empty = document.createElement("div");
      empty.className = "simple-ui-empty";
      empty.innerHTML = `
        <div>No cases defined yet.</div>
        <button id="create-first-case">Create First Case</button>
      `;
      empty.querySelector("#create-first-case")?.addEventListener("click", () => {
        this.addCase();
      });
      this.container.appendChild(empty);
    }
  }
  renderLedgersSection() {
    const section = document.createElement("div");
    section.className = "simple-ui-section";
    const header = document.createElement("div");
    header.className = "simple-ui-section-header";
    header.innerHTML = `
      <span>Ledgers</span>
      <button class="add-btn">+ Add</button>
    `;
    header.querySelector(".add-btn")?.addEventListener("click", () => this.addLedger());
    section.appendChild(header);
    const table = document.createElement("table");
    table.className = "simple-ui-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th style="width: 200px;">Name</th>
          <th style="width: 80px;">ID</th>
          <th style="width: 40px;"></th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector("tbody");
    this.model.ledgers.forEach((ledger, idx) => {
      const row = this.renderLedgerRow(ledger, idx);
      tbody.appendChild(row);
    });
    section.appendChild(table);
    return section;
  }
  renderLedgerRow(ledger, idx) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="text" class="ledger-name" value="${esc(ledger.name)}" placeholder="LEDGER_NAME"></td>
      <td><input type="number" class="ledger-id" value="${ledger.id}" min="1"></td>
      <td><button class="delete-btn" title="Delete">&times;</button></td>
    `;
    tr.querySelector(".ledger-name")?.addEventListener("change", (e) => {
      this.model.ledgers[idx].name = e.target.value.toUpperCase();
      this.emitChange();
    });
    tr.querySelector(".ledger-id")?.addEventListener("change", (e) => {
      this.model.ledgers[idx].id = parseInt(e.target.value, 10) || 1;
      this.emitChange();
    });
    const deleteBtn = tr.querySelector(".delete-btn");
    if (this.model.ledgers.length <= 1) {
      deleteBtn.disabled = true;
      deleteBtn.title = "Cannot delete the only ledger";
    }
    deleteBtn.addEventListener("click", () => {
      if (this.model.ledgers.length > 1) {
        this.model.ledgers.splice(idx, 1);
        this.emitChange();
        this.render();
      }
    });
    return tr;
  }
  addLedger() {
    const maxId = this.model.ledgers.reduce((max, l) => Math.max(max, l.id), 0);
    this.model.ledgers.push({ name: "NEW", id: maxId + 1 });
    this.emitChange();
    this.render();
  }
  renderCaseSelector() {
    const wrapper = document.createElement("div");
    wrapper.className = "case-header-wrapper";
    const selectorRow = document.createElement("div");
    selectorRow.className = "case-selector";
    const caseOptions = this.model.cases.map((c, idx) => ({
      value: idx.toString(),
      label: c.name
    }));
    const caseSelect = this.createSingleSelect(caseOptions, this.selectedCaseIndex.toString(), (val) => {
      this.selectedCaseIndex = parseInt(val, 10);
      this.render();
    }, "Select case...");
    caseSelect.classList.add("case-select-wrapper");
    const renameBtn = document.createElement("button");
    renameBtn.className = "case-action-btn";
    renameBtn.textContent = "✎";
    renameBtn.title = "Edit case";
    const addBtn = document.createElement("button");
    addBtn.className = "add-btn";
    addBtn.textContent = "+ Add Case";
    addBtn.addEventListener("click", () => this.addCase());
    selectorRow.appendChild(caseSelect);
    selectorRow.appendChild(renameBtn);
    selectorRow.appendChild(addBtn);
    wrapper.appendChild(selectorRow);
    const selectedCase = this.model.cases[this.selectedCaseIndex];
    const renameRow = document.createElement("div");
    renameRow.className = "case-rename-row";
    renameRow.style.display = "none";
    const renameInput = document.createElement("input");
    renameInput.type = "text";
    renameInput.className = "case-rename-input";
    renameInput.placeholder = "Case name...";
    if (selectedCase)
      renameInput.value = selectedCase.name;
    const saveBtn = document.createElement("button");
    saveBtn.className = "save-btn";
    saveBtn.textContent = "Save";
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-case-btn";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      if (this.model.cases.length <= 1) {
        alert("Cannot delete the last case");
        return;
      }
      if (confirm(`Delete case "${selectedCase?.name}"?`)) {
        this.model.cases.splice(this.selectedCaseIndex, 1);
        this.selectedCaseIndex = Math.max(0, this.selectedCaseIndex - 1);
        this.emitChange();
        this.render();
      }
    });
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "cancel-btn";
    cancelBtn.textContent = "Cancel";
    renameBtn.addEventListener("click", () => {
      renameRow.style.display = "flex";
      renameInput.focus();
      renameInput.select();
    });
    const sanitizeName = (name) => {
      let sanitized = name.trim().replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "").replace(/^(\d)/, "_$1");
      return sanitized || "case";
    };
    const validateAndUpdate = () => {
      const sanitized = sanitizeName(renameInput.value);
      if (sanitized !== renameInput.value.trim()) {
        renameInput.value = sanitized;
      }
    };
    renameInput.addEventListener("input", validateAndUpdate);
    const doSave = () => {
      if (selectedCase) {
        const sanitized = sanitizeName(renameInput.value);
        if (sanitized) {
          selectedCase.name = sanitized;
          this.emitChange();
          this.render();
        }
      }
      renameRow.style.display = "none";
    };
    saveBtn.addEventListener("click", doSave);
    renameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter")
        doSave();
      if (e.key === "Escape")
        renameRow.style.display = "none";
    });
    cancelBtn.addEventListener("click", () => {
      renameRow.style.display = "none";
    });
    renameRow.appendChild(renameInput);
    renameRow.appendChild(saveBtn);
    renameRow.appendChild(deleteBtn);
    renameRow.appendChild(cancelBtn);
    wrapper.appendChild(renameRow);
    if (selectedCase) {
      const descDiv = document.createElement("div");
      descDiv.className = "case-description";
      const descLabel = document.createElement("label");
      descLabel.textContent = "Description:";
      descLabel.className = "case-desc-label";
      const descInput = document.createElement("textarea");
      descInput.className = "case-desc-input";
      descInput.placeholder = "Describe what this case demonstrates...";
      descInput.value = selectedCase.description.join(`
`);
      descInput.rows = 2;
      descInput.addEventListener("change", (e) => {
        const val = e.target.value;
        selectedCase.description = val ? val.split(`
`).filter((l) => l.trim()) : [];
        this.emitChange();
      });
      descDiv.appendChild(descLabel);
      descDiv.appendChild(descInput);
      wrapper.appendChild(descDiv);
    }
    return wrapper;
  }
  addCase() {
    const num = this.model.cases.length + 1;
    const padded = num.toString().padStart(3, "0");
    const newCase = createEmptyCase(`case${padded}_001`);
    newCase.startId = (num * 1000 + 1e4).toString();
    this.model.cases.push(newCase);
    this.selectedCaseIndex = this.model.cases.length - 1;
    this.emitChange();
    this.render();
  }
  renderAccountsSection(caseModel) {
    const section = document.createElement("div");
    section.className = "simple-ui-section";
    const header = document.createElement("div");
    header.className = "simple-ui-section-header";
    header.innerHTML = `
      <span>Schema (Accounts)</span>
      <button class="add-btn">+ Add Account</button>
    `;
    header.querySelector(".add-btn")?.addEventListener("click", () => {
      caseModel.accounts.push({
        name: "new:account",
        ledger: this.model.ledgers[0]?.name ?? "LEDGER",
        type: "Asset",
        flags: []
      });
      this.emitChange();
      this.render();
    });
    section.appendChild(header);
    const table = document.createElement("table");
    table.className = "simple-ui-table accounts-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th style="width: 200px;">ID (Name)</th>
          <th style="width: 100px;">Ledger</th>
          <th style="width: 100px;">Type</th>
          <th style="width: 140px;">Flags</th>
          <th style="width: 180px;">Description</th>
          <th style="width: 36px;"></th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector("tbody");
    caseModel.accounts.forEach((account, idx) => {
      const row = this.renderAccountRow(account, idx, caseModel);
      tbody.appendChild(row);
    });
    section.appendChild(table);
    return section;
  }
  renderAccountRow(account, idx, caseModel) {
    const tr = document.createElement("tr");
    const nameTd = document.createElement("td");
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = account.name;
    nameInput.placeholder = "account:name";
    nameInput.addEventListener("change", (e) => {
      account.name = e.target.value;
      this.emitChange();
    });
    nameTd.appendChild(nameInput);
    tr.appendChild(nameTd);
    const ledgerTd = document.createElement("td");
    const ledgerOptions = this.model.ledgers.map((l) => ({ value: l.name, label: l.name }));
    ledgerTd.appendChild(this.createSingleSelect(ledgerOptions, account.ledger, (val) => {
      account.ledger = val;
      this.emitChange();
    }));
    tr.appendChild(ledgerTd);
    const typeTd = document.createElement("td");
    const typeOptions = ACCOUNT_TYPES.map((t) => ({ value: t, label: t }));
    const typeSelect = this.createSingleSelect(typeOptions, account.type, (val) => {
      account.type = val;
      const display2 = typeSelect.querySelector(".custom-select-display");
      if (display2) {
        display2.className = `custom-select-display pill pill-${val.toLowerCase()}`;
      }
      this.emitChange();
    });
    const display = typeSelect.querySelector(".custom-select-display");
    if (display) {
      display.classList.add("pill", `pill-${account.type.toLowerCase()}`);
    }
    typeTd.appendChild(typeSelect);
    tr.appendChild(typeTd);
    const flagsTd = document.createElement("td");
    flagsTd.appendChild(this.createMultiSelect(ACCOUNT_FLAGS, account.flags, (values) => {
      account.flags = values;
      this.emitChange();
    }, "(none)"));
    tr.appendChild(flagsTd);
    const descTd = document.createElement("td");
    const descInput = document.createElement("input");
    descInput.type = "text";
    descInput.value = account.description ?? "";
    descInput.placeholder = "Account description...";
    descInput.className = "desc-input";
    descInput.addEventListener("change", (e) => {
      account.description = e.target.value || undefined;
      this.emitChange();
    });
    descTd.appendChild(descInput);
    tr.appendChild(descTd);
    const actionsTd = document.createElement("td");
    actionsTd.className = "actions-cell";
    const cloneBtn = document.createElement("button");
    cloneBtn.className = "action-btn clone-btn";
    cloneBtn.innerHTML = "⧉";
    cloneBtn.title = "Clone";
    cloneBtn.addEventListener("click", () => {
      const cloned = {
        name: account.name + "_copy",
        ledger: account.ledger,
        type: account.type,
        flags: [...account.flags],
        description: account.description
      };
      caseModel.accounts.splice(idx + 1, 0, cloned);
      this.emitChange();
      this.render();
    });
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "action-btn delete-btn";
    deleteBtn.innerHTML = "&times;";
    deleteBtn.title = "Delete";
    deleteBtn.addEventListener("click", () => {
      caseModel.accounts.splice(idx, 1);
      this.emitChange();
      this.render();
    });
    actionsTd.appendChild(cloneBtn);
    actionsTd.appendChild(deleteBtn);
    tr.appendChild(actionsTd);
    return tr;
  }
  renderBatchesSection(caseModel) {
    const section = document.createElement("div");
    section.className = "simple-ui-section";
    const header = document.createElement("div");
    header.className = "simple-ui-section-header";
    header.innerHTML = `<span>Batches</span>`;
    section.appendChild(header);
    caseModel.batches.forEach((batch, idx) => {
      section.appendChild(this.renderBatch(batch, idx, caseModel));
    });
    const footer = document.createElement("div");
    footer.className = "simple-ui-section-footer";
    const addBtn = document.createElement("button");
    addBtn.className = "add-btn";
    addBtn.textContent = "+ Add Batch";
    addBtn.addEventListener("click", () => {
      const nextIdx = caseModel.batches.length > 0 ? Math.max(...caseModel.batches.map((b) => b.index)) + 1 : 0;
      caseModel.batches.push(createEmptyBatch(nextIdx));
      this.emitChange();
      this.render();
    });
    footer.appendChild(addBtn);
    section.appendChild(footer);
    return section;
  }
  renderBatch(batch, batchIdx, caseModel) {
    const div = document.createElement("div");
    div.className = "batch-section";
    const header = document.createElement("div");
    header.className = "batch-header";
    const numSpan = document.createElement("span");
    numSpan.className = "batch-num";
    numSpan.textContent = `Batch ${batch.index}:`;
    header.appendChild(numSpan);
    const descInput = document.createElement("input");
    descInput.type = "text";
    descInput.className = "batch-desc";
    descInput.value = batch.description.join(" | ");
    descInput.placeholder = "Batch description...";
    descInput.addEventListener("change", (e) => {
      const val = e.target.value;
      batch.description = val ? [val] : [];
      this.emitChange();
    });
    descInput.addEventListener("click", (e) => e.stopPropagation());
    header.appendChild(descInput);
    const upBtn = document.createElement("button");
    upBtn.className = "batch-reorder-btn";
    upBtn.innerHTML = "↑";
    upBtn.title = "Move batch up";
    upBtn.disabled = batchIdx === 0;
    upBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (batchIdx > 0) {
        [caseModel.batches[batchIdx - 1], caseModel.batches[batchIdx]] = [caseModel.batches[batchIdx], caseModel.batches[batchIdx - 1]];
        caseModel.batches.forEach((b, i) => b.index = i);
        this.emitChange();
        this.render();
      }
    });
    header.appendChild(upBtn);
    const downBtn = document.createElement("button");
    downBtn.className = "batch-reorder-btn";
    downBtn.innerHTML = "↓";
    downBtn.title = "Move batch down";
    downBtn.disabled = batchIdx === caseModel.batches.length - 1;
    downBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (batchIdx < caseModel.batches.length - 1) {
        [caseModel.batches[batchIdx], caseModel.batches[batchIdx + 1]] = [caseModel.batches[batchIdx + 1], caseModel.batches[batchIdx]];
        caseModel.batches.forEach((b, i) => b.index = i);
        this.emitChange();
        this.render();
      }
    });
    header.appendChild(downBtn);
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.innerHTML = "&times;";
    deleteBtn.title = "Delete batch";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      caseModel.batches.splice(batchIdx, 1);
      this.emitChange();
      this.render();
    });
    header.appendChild(deleteBtn);
    div.appendChild(header);
    const content = document.createElement("div");
    content.className = "batch-content";
    const table = document.createElement("table");
    table.className = "simple-ui-table transfers-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th class="col-id">ID</th>
          <th class="col-ledger">Ledger</th>
          <th class="col-amount">Amount</th>
          <th class="col-account">Debit Account</th>
          <th class="col-account">Credit Account</th>
          <th class="col-flags">Flags</th>
          <th class="col-more">Options</th>
          <th class="col-actions"></th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector("tbody");
    batch.transfers.forEach((transfer, idx) => {
      const row = this.renderTransferRow(transfer, idx, batch, caseModel);
      tbody.appendChild(row);
    });
    const addRow = document.createElement("tr");
    addRow.innerHTML = `
      <td colspan="8" style="text-align: center;">
        <button class="add-btn" style="margin: 4px 0;">+ Add Transfer</button>
      </td>
    `;
    addRow.querySelector(".add-btn")?.addEventListener("click", () => {
      const startId = parseInt(caseModel.startId ?? "10000", 10);
      const maxId = batch.transfers.reduce((max, t) => Math.max(max, parseInt(t.id, 10)), startId);
      batch.transfers.push({
        id: (maxId + 1).toString(),
        ledger: this.model.ledgers[0]?.name ?? "LEDGER",
        amount: "0",
        debitAccount: caseModel.accounts[0]?.name ?? "",
        creditAccount: caseModel.accounts[1]?.name ?? caseModel.accounts[0]?.name ?? "",
        flags: ""
      });
      this.emitChange();
      this.render();
    });
    tbody.appendChild(addRow);
    content.appendChild(table);
    div.appendChild(content);
    return div;
  }
  renderTransferRow(transfer, idx, batch, caseModel) {
    const tr = document.createElement("tr");
    const idTd = document.createElement("td");
    idTd.className = "col-id";
    const idInput = document.createElement("input");
    idInput.type = "text";
    idInput.value = transfer.id;
    idInput.addEventListener("change", (e) => {
      transfer.id = e.target.value.replace(/n$/, "");
      this.emitChange();
    });
    idTd.appendChild(idInput);
    tr.appendChild(idTd);
    const ledgerTd = document.createElement("td");
    ledgerTd.className = "col-ledger";
    const ledgerOptions = this.model.ledgers.map((l) => ({ value: l.name, label: l.name }));
    ledgerTd.appendChild(this.createSingleSelect(ledgerOptions, transfer.ledger, (val) => {
      transfer.ledger = val;
      this.emitChange();
    }));
    tr.appendChild(ledgerTd);
    const amountTd = document.createElement("td");
    amountTd.className = "col-amount";
    const amountInput = document.createElement("input");
    amountInput.type = "text";
    amountInput.value = transfer.amount;
    amountInput.addEventListener("change", (e) => {
      transfer.amount = e.target.value.replace(/n$/, "");
      this.emitChange();
    });
    amountTd.appendChild(amountInput);
    tr.appendChild(amountTd);
    const drTd = document.createElement("td");
    drTd.className = "col-account";
    drTd.appendChild(this.createAccountSelectWithType(transfer.debitAccount, caseModel.accounts, (val) => {
      transfer.debitAccount = val;
      this.emitChange();
      this.render();
    }));
    tr.appendChild(drTd);
    const crTd = document.createElement("td");
    crTd.className = "col-account";
    crTd.appendChild(this.createAccountSelectWithType(transfer.creditAccount, caseModel.accounts, (val) => {
      transfer.creditAccount = val;
      this.emitChange();
      this.render();
    }));
    tr.appendChild(crTd);
    const flagsTd = document.createElement("td");
    flagsTd.className = "col-flags";
    const currentFlags = transfer.flags ? transfer.flags.split("|").map((f) => f.trim()).filter(Boolean) : [];
    flagsTd.appendChild(this.createMultiSelect(TRANSFER_FLAGS_MULTI, currentFlags, (values) => {
      transfer.flags = values.join(" | ");
      this.emitChange();
      this.render();
    }, "(none)"));
    tr.appendChild(flagsTd);
    const optsTd = document.createElement("td");
    optsTd.className = "col-more";
    const optsDiv = document.createElement("div");
    optsDiv.className = "transfer-options";
    const flagsArr = transfer.flags ? transfer.flags.split("|").map((f) => f.trim()) : [];
    const needsPendingId = flagsArr.includes("post_pending_transfer") || flagsArr.includes("void_pending_transfer");
    const pendingDiv = document.createElement("div");
    pendingDiv.className = "option-row";
    const pendingLabel = document.createElement("span");
    pendingLabel.className = "option-label";
    pendingLabel.textContent = "pending_id:";
    const pendingSelect = document.createElement("select");
    pendingSelect.className = "styled-select";
    pendingSelect.disabled = !needsPendingId;
    if (!needsPendingId) {
      pendingDiv.classList.add("disabled");
    }
    const emptyOpt = document.createElement("option");
    emptyOpt.value = "";
    emptyOpt.textContent = needsPendingId ? "(select)" : "—";
    pendingSelect.appendChild(emptyOpt);
    if (needsPendingId) {
      caseModel.batches.forEach((b) => {
        b.transfers.forEach((t) => {
          const tFlags = t.flags ? t.flags.split("|").map((f) => f.trim()) : [];
          if (tFlags.includes("pending")) {
            const opt = document.createElement("option");
            opt.value = t.id;
            opt.textContent = t.id;
            opt.selected = t.id === transfer.pendingId;
            pendingSelect.appendChild(opt);
          }
        });
      });
    }
    pendingSelect.addEventListener("change", (e) => {
      transfer.pendingId = e.target.value || undefined;
      this.emitChange();
    });
    pendingDiv.appendChild(pendingLabel);
    pendingDiv.appendChild(pendingSelect);
    optsDiv.appendChild(pendingDiv);
    const failsDiv = document.createElement("div");
    failsDiv.className = "option-row";
    const failsLabel = document.createElement("span");
    failsLabel.className = "option-label";
    failsLabel.textContent = "failsWith:";
    const failsInput = document.createElement("input");
    failsInput.type = "text";
    failsInput.placeholder = "(expected error)";
    failsInput.value = transfer.failsWith ?? "";
    failsInput.addEventListener("change", (e) => {
      transfer.failsWith = e.target.value || undefined;
      this.emitChange();
    });
    failsDiv.appendChild(failsLabel);
    failsDiv.appendChild(failsInput);
    optsDiv.appendChild(failsDiv);
    optsTd.appendChild(optsDiv);
    tr.appendChild(optsTd);
    const actionsTd = document.createElement("td");
    actionsTd.className = "col-actions";
    const upBtn = document.createElement("button");
    upBtn.className = "reorder-btn";
    upBtn.innerHTML = "↑";
    upBtn.title = "Move up";
    upBtn.disabled = idx === 0;
    upBtn.addEventListener("click", () => {
      if (idx > 0) {
        [batch.transfers[idx - 1], batch.transfers[idx]] = [batch.transfers[idx], batch.transfers[idx - 1]];
        this.emitChange();
        this.render();
      }
    });
    actionsTd.appendChild(upBtn);
    const downBtn = document.createElement("button");
    downBtn.className = "reorder-btn";
    downBtn.innerHTML = "↓";
    downBtn.title = "Move down";
    downBtn.disabled = idx === batch.transfers.length - 1;
    downBtn.addEventListener("click", () => {
      if (idx < batch.transfers.length - 1) {
        [batch.transfers[idx], batch.transfers[idx + 1]] = [batch.transfers[idx + 1], batch.transfers[idx]];
        this.emitChange();
        this.render();
      }
    });
    actionsTd.appendChild(downBtn);
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-row-btn";
    deleteBtn.innerHTML = "×";
    deleteBtn.title = "Delete transfer";
    deleteBtn.addEventListener("click", () => {
      batch.transfers.splice(idx, 1);
      this.emitChange();
      this.render();
    });
    actionsTd.appendChild(deleteBtn);
    tr.appendChild(actionsTd);
    return tr;
  }
  createAccountSelectWithType(currentValue, accounts, onChange) {
    const wrapper = document.createElement("div");
    wrapper.className = "account-select-wrapper";
    const select = document.createElement("select");
    select.className = "styled-select account-select";
    const hasValue = accounts.some((a) => a.name === currentValue);
    if (!hasValue && currentValue) {
      const opt = document.createElement("option");
      opt.value = currentValue;
      opt.textContent = currentValue;
      opt.selected = true;
      select.appendChild(opt);
    }
    accounts.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a.name;
      opt.textContent = a.name;
      opt.selected = a.name === currentValue;
      select.appendChild(opt);
    });
    select.addEventListener("change", (e) => {
      onChange(e.target.value);
    });
    wrapper.appendChild(select);
    const account = accounts.find((a) => a.name === currentValue);
    if (account) {
      const pill = document.createElement("span");
      pill.className = `account-type-pill pill-${account.type.toLowerCase()}`;
      pill.textContent = account.type.substring(0, 1);
      pill.title = account.type;
      wrapper.appendChild(pill);
    }
    return wrapper;
  }
  createAccountSelect(currentValue, accounts, onChange) {
    const select = document.createElement("select");
    const hasValue = accounts.some((a) => a.name === currentValue);
    if (!hasValue && currentValue) {
      const opt = document.createElement("option");
      opt.value = currentValue;
      opt.textContent = currentValue;
      opt.selected = true;
      select.appendChild(opt);
    }
    accounts.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a.name;
      opt.textContent = a.name;
      opt.selected = a.name === currentValue;
      select.appendChild(opt);
    });
    select.addEventListener("change", (e) => {
      onChange(e.target.value);
    });
    return select;
  }
  getFlagPillClass(flag) {
    if (flag === "pending")
      return "pill-pending";
    if (flag === "post_pending_transfer")
      return "pill-post";
    if (flag === "void_pending_transfer")
      return "pill-void";
    if (flag.includes("balancing"))
      return "pill-balancing";
    if (flag.includes("closing"))
      return "pill-closing";
    if (flag === "linked")
      return "pill-linked";
    return "";
  }
  createSingleSelect(options, selectedValue, onChange, placeholder = "Select...") {
    const wrapper = document.createElement("div");
    wrapper.className = "custom-select";
    const display = document.createElement("div");
    display.className = "custom-select-display";
    const updateDisplay = () => {
      display.innerHTML = "";
      const selected = options.find((o) => o.value === selectedValue);
      const valueSpan = document.createElement("span");
      valueSpan.className = "custom-select-value";
      valueSpan.textContent = selected ? selected.label : placeholder;
      if (!selected)
        valueSpan.classList.add("placeholder");
      display.appendChild(valueSpan);
      const arrow = document.createElement("span");
      arrow.className = "custom-select-arrow";
      arrow.textContent = "▾";
      display.appendChild(arrow);
    };
    const dropdown = document.createElement("div");
    dropdown.className = "custom-select-dropdown";
    dropdown.style.display = "none";
    const updateDropdown = () => {
      dropdown.innerHTML = "";
      options.forEach((opt) => {
        const item = document.createElement("div");
        item.className = "custom-select-item";
        if (opt.value === selectedValue) {
          item.classList.add("selected");
        }
        item.textContent = opt.label;
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          selectedValue = opt.value;
          onChange(opt.value);
          updateDisplay();
          updateDropdown();
          dropdown.style.display = "none";
        });
        dropdown.appendChild(item);
      });
    };
    display.addEventListener("click", (e) => {
      e.stopPropagation();
      const isVisible = dropdown.style.display !== "none";
      document.querySelectorAll(".custom-select-dropdown, .multi-select-dropdown").forEach((d) => {
        d.style.display = "none";
      });
      if (!isVisible) {
        const rect = display.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const dropdownHeight = Math.min(200, options.length * 30);
        dropdown.style.position = "fixed";
        dropdown.style.left = `${rect.left}px`;
        dropdown.style.width = `${rect.width}px`;
        if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
          dropdown.style.top = "auto";
          dropdown.style.bottom = `${window.innerHeight - rect.top + 2}px`;
        } else {
          dropdown.style.top = `${rect.bottom + 2}px`;
          dropdown.style.bottom = "auto";
        }
        dropdown.style.display = "block";
      } else {
        dropdown.style.display = "none";
      }
    });
    document.addEventListener("click", () => {
      dropdown.style.display = "none";
      dropdown.classList.remove("flip-up");
    });
    updateDisplay();
    updateDropdown();
    wrapper.appendChild(display);
    wrapper.appendChild(dropdown);
    return wrapper;
  }
  createMultiSelect(options, selectedValues, onChange, placeholder = "Select flags...") {
    const wrapper = document.createElement("div");
    wrapper.className = "multi-select";
    const display = document.createElement("div");
    display.className = "multi-select-display";
    const updateDisplay = () => {
      display.innerHTML = "";
      if (selectedValues.length === 0) {
        const placeholder_el = document.createElement("span");
        placeholder_el.className = "multi-select-placeholder";
        placeholder_el.textContent = placeholder;
        display.appendChild(placeholder_el);
      } else {
        selectedValues.forEach((val) => {
          const opt = options.find((o) => o.value === val);
          if (opt) {
            const pill = document.createElement("span");
            pill.className = `multi-select-pill ${this.getFlagPillClass(val)}`;
            pill.textContent = opt.short;
            pill.title = opt.label;
            const removeBtn = document.createElement("span");
            removeBtn.className = "multi-select-pill-remove";
            removeBtn.textContent = "×";
            removeBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              selectedValues = selectedValues.filter((v) => v !== val);
              onChange(selectedValues);
              updateDisplay();
              updateDropdown();
            });
            pill.appendChild(removeBtn);
            display.appendChild(pill);
          }
        });
      }
      const arrow = document.createElement("span");
      arrow.className = "multi-select-arrow";
      arrow.textContent = "▾";
      display.appendChild(arrow);
    };
    const dropdown = document.createElement("div");
    dropdown.className = "multi-select-dropdown";
    dropdown.style.display = "none";
    const updateDropdown = () => {
      dropdown.innerHTML = "";
      options.forEach((opt) => {
        const item = document.createElement("label");
        item.className = "multi-select-item";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selectedValues.includes(opt.value);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) {
            if (!selectedValues.includes(opt.value)) {
              selectedValues = [...selectedValues, opt.value];
            }
          } else {
            selectedValues = selectedValues.filter((v) => v !== opt.value);
          }
          onChange(selectedValues);
          updateDisplay();
        });
        const label = document.createElement("span");
        label.className = "multi-select-item-label";
        label.textContent = opt.label;
        item.appendChild(checkbox);
        item.appendChild(label);
        dropdown.appendChild(item);
      });
    };
    display.addEventListener("click", (e) => {
      e.stopPropagation();
      const isVisible = dropdown.style.display !== "none";
      document.querySelectorAll(".multi-select-dropdown, .custom-select-dropdown").forEach((d) => {
        d.style.display = "none";
      });
      if (!isVisible) {
        const rect = display.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const dropdownHeight = Math.min(200, options.length * 30);
        dropdown.style.position = "fixed";
        dropdown.style.left = `${rect.left}px`;
        dropdown.style.minWidth = `${Math.max(rect.width, 220)}px`;
        if (spaceBelow < dropdownHeight && rect.top > dropdownHeight) {
          dropdown.style.top = "auto";
          dropdown.style.bottom = `${window.innerHeight - rect.top + 2}px`;
        } else {
          dropdown.style.top = `${rect.bottom + 2}px`;
          dropdown.style.bottom = "auto";
        }
        dropdown.style.display = "block";
      } else {
        dropdown.style.display = "none";
      }
    });
    document.addEventListener("click", () => {
      dropdown.style.display = "none";
    });
    updateDisplay();
    updateDropdown();
    wrapper.appendChild(display);
    wrapper.appendChild(dropdown);
    return wrapper;
  }
}
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// src/playground/recipes.ts
var RECIPES = [
  {
    id: "default",
    name: "Basic",
    description: "Basic usage of Playground.",
    code: `// Define Ledgers.
const USD = defineLedger("USD", 1);

// Create a case function
async function basic() {
  resetAccountRegistry(1000n, "basic");
  const ctx = new CaseContext();

  // Define accounts.
  await ctx.createAccounts([
    account({ name: "Alice", ledger: USD, type: "Asset", flags: "" }),
    account({ name: "Bob", ledger: USD, type: "Liability", flags: "" }),
    account({ name: "Charlie", ledger: USD, type: "Liability", flags: "" }),
  ]);

  // Create transfers
  // Wrapping them in ctx.batch automatically inserts the required 'linked' flag.
  await ctx.batch(0, "Initial transfer", [
    transfer(1001n, USD, 100n, "Alice", "Bob"),
    transfer(1002n, USD, 50n,  "Bob", "Charlie"),
  ]);
}

await basic();
`
  },
  {
    id: "currency_exchange",
    name: "Currency Exchange",
    description: "Demonstrates currency exchange between USD and INR with different scenarios.",
    code: `// Define ledgers
const USD = defineLedger("USD", 1, 2);
const INR = defineLedger("INR", 2, 2);

// ─── recipe_currency_exchange ────────────────────────────────────────────────────────────
async function recipe_currency_exchange_simple() {
  resetAccountRegistry(1000n, "recipe_currency_exchange_simple");
  const ctx = new CaseContext();

  // Create accounts
  await ctx.createAccounts([
    account({name: "USD:CTL", ledger: USD, type: "Asset", flags: ""}),
    account({name: "INR:CTL", ledger: INR, type: "Asset", flags: ""}),
    account({ name: "A1", ledger: USD, type: "Liability", flags: "debits_must_not_exceed_credits" }),
    account({ name: "A2", ledger: INR, type: "Liability", flags: "debits_must_not_exceed_credits" }),
    account({ name: "L1", ledger: USD, type: "Liability", flags: "debits_must_not_exceed_credits" }),
    account({ name: "L2", ledger: INR, type: "Liability", flags: "debits_must_not_exceed_credits" }),
  ]);

  // Batch 0: Set up the scenario.
  await ctx.batch(0, [
    "Fund A1 with 100.00 USD.",
    "Fund A2 with 10000.00 INR.",
    ], [
    transfer(1001n, USD, 10000n,   "USD:CTL", "A1"),
    transfer(1002n, INR, 1000000n, "INR:CTL", "L2"),
  ]);

  // Consider sending 100.00 USD from account A₁ (denominated in USD) to account A₂ (denominated in INR).
  // Assuming an exchange rate of 1.00 USD = 82.42135 INR, 100.00 USD = 8242.14 INR:
  await ctx.batch(1, "Exchange 100.00 USD for 8242.14 INR.", [
    transfer(1003n, USD, 10000n,  "A1", "L1"),
    transfer(1004n, INR, 824214n, "L2", "A2"),
  ]);
}

async function recipe_currency_exchange_spread() {
  resetAccountRegistry(1001n, "recipe_currency_exchange_spread");
  const ctx = new CaseContext();

  // Create accounts
  await ctx.createAccounts([
    account({name: "USD:CTL", ledger: USD, type: "Asset", flags: ""}),
    account({name: "INR:CTL", ledger: INR, type: "Asset", flags: ""}),
    account({ name: "A1", ledger: USD, type: "Liability", flags: "debits_must_not_exceed_credits" }),
    account({ name: "A2", ledger: INR, type: "Liability", flags: "debits_must_not_exceed_credits" }),
    account({ name: "L1", ledger: USD, type: "Liability", flags: "debits_must_not_exceed_credits" }),
    account({ name: "L2", ledger: INR, type: "Liability", flags: "debits_must_not_exceed_credits" }),
  ]);

  // Batch 0: Set up the scenario.
  await ctx.batch(0, [
    "Fund A1 with 101.00 USD.",
    "Fund A2 with 10000.00 INR.",
    ], [
    transfer(1001n, USD, 10100n,   "USD:CTL", "A1"),
    transfer(1002n, INR, 1000000n, "INR:CTL", "L2"),
  ]);

  // This depicts the same scenario as the prior example, except the liquidity provider charges a
  // 0.10 USD fee for the transaction.
   await ctx.batch(1, "Exchange 100.00 USD for 8242.14 INR with 0.10 USD fee.", [
    transfer(1005n, USD, 10000n,  "A1", "L1"),
    transfer(1006n, USD, 10n,  "A1", "L1"),
    transfer(1007n, INR, 824214n, "L2", "A2"),
  ]);
}

await recipe_currency_exchange_simple();
await recipe_currency_exchange_spread();
`
  },
  {
    id: "multi_debit_multi_credit",
    name: "Multi-Debit, Multi-Credit Transfers",
    description: "Demonstrates how to used the `linked` flag to combine transfers together.",
    code: `// Define ledgers
const USD = defineLedger("USD", 1);

async function single_debit_multi_credit() {
  resetAccountRegistry(1000n, "single_debit_multi_credit");
  const ctx = new CaseContext();

  // Create accounts
  await ctx.createAccounts([
    account({ name: "A", ledger: USD, type: "Asset", flags: 'credits_must_not_exceed_debits'}),
    account({ name: "X", ledger: USD, type: "Liability" }),
    account({ name: "Y", ledger: USD, type: "Liability" }),
    account({ name: "Z", ledger: USD, type: "Liability" }),
  ]);

  await ctx.batch(1, "Debit A, Credit X, Y, Z.", [
    transfer(1000n, USD, 10000n, "A", "X"),
    transfer(1001n, USD, 50n,    "A", "Y"),
    transfer(1002n, USD, 10n,    "A", "Z"),
  ]);
}

async function multi_debit_single_credit() {
  resetAccountRegistry(2000n, "multi_debit_single_credit");
  const ctx = new CaseContext();

  // Create accounts
  await ctx.createAccounts([
    account({ name: "A", ledger: USD, type: "Asset" }),
    account({ name: "B", ledger: USD, type: "Asset" }),
    account({ name: "C", ledger: USD, type: "Asset" }),
    account({ name: "X", ledger: USD, type: "Liability" }),
  ]);

  await ctx.batch(1, "Debit A, B, C, Credit X.", [
    transfer(1100n, USD, 10000n, "A", "X"),
    transfer(1101n, USD, 50n,    "B", "X"),
    transfer(1102n, USD, 10n,    "C", "X"),
  ]);
}

async function multi_debit_single_credit_balancing_debits() {
  resetAccountRegistry(3000n, "multi_debit_single_credit_balancing_debits");
  const ctx = new CaseContext();

  // Create accounts
  await ctx.createAccounts([
    // Source Accounts.
    account({ name: "A", ledger: USD, type: "Liability", flags: "debits_must_not_exceed_credits" }),
    account({ name: "B", ledger: USD, type: "Liability", flags: "debits_must_not_exceed_credits" }),
    account({ name: "C", ledger: USD, type: "Liability", flags: "debits_must_not_exceed_credits" }),
    // Destination Account.
    account({ name: "X", ledger: USD, type: "Liability" }),
    // Control Accounts.
    account({ name: "LIMIT", ledger: USD, type: "Liability", flags: 'debits_must_not_exceed_credits' }),
    account({ name: "SETUP", ledger: USD, type: "Liability" }),
    account({ name: "SOURCE", ledger: USD, type: "Liability" }),
  ]);

  await ctx.batch(0, "Fund A, B, C. with a total of 101", [
    transfer(1200n, USD, 50n, "SOURCE", "A"),
    transfer(1201n, USD, 35n, "SOURCE", "B"),
    transfer(1202n, USD, 16n, "SOURCE", "C"),
  ]);

  await ctx.batch(1, "Debit A, B, C, Credit X.", [
    transfer(1203n, USD, 100n, "SETUP", "LIMIT"),
    transfer(1204n, USD, 100n, "A", "SETUP", "balancing_debit | balancing_credit"),
    transfer(1205n, USD, 100n, "B", "SETUP", "balancing_debit | balancing_credit"),
    transfer(1206n, USD, 100n, "C", "SETUP", "balancing_debit | balancing_credit"),
    transfer(1207n, USD, 100n, "SETUP", "X", ""),
    transfer(1208n, USD, amount_max, "LIMIT", "SETUP", "balancing_credit"),
  ]);
}

async function many_to_many() {
  resetAccountRegistry(4000n, "many_to_many");
  const ctx = new CaseContext();

  // Create accounts
  await ctx.createAccounts([
    // Source Accounts.
    account({ name: "A", ledger: USD, type: "Asset"}),
    account({ name: "B", ledger: USD, type: "Asset"}),
    // Destination Accounts.
    account({ name: "X", ledger: USD, type: "Liability" }),
    account({ name: "Y", ledger: USD, type: "Liability" }),
    account({ name: "Z", ledger: USD, type: "Liability" }),
    // Control Account.
    account({ name: "CONTROL", ledger: USD, type: "Liability", flags: "" }),
  ]);

  await ctx.batch(1, "Debit A, B, Credit X, Y, Z.", [
    transfer(1300n, USD, 10000n, "A", "CONTROL"),
    transfer(1301n, USD, 50n,    "B", "CONTROL"),
    transfer(1302n, USD, 9000n,    "CONTROL", "X"),
    transfer(1303n, USD, 1000n,    "CONTROL", "Y"),
    transfer(1304n, USD, 50n,    "CONTROL", "Z"),

  ]);
}   

// await single_debit_multi_credit();
// await multi_debit_single_credit();
// await multi_debit_single_credit_balancing_debits();
await many_to_many();


`
  }
];
function getRecipeById(id) {
  return RECIPES.find((r) => r.id === id);
}
function getDefaultRecipe() {
  return RECIPES[0];
}

// src/playground/tb.ts
var amount_max = 0xffff_ffff_ffff_ffff_ffff_ffff_ffff_ffffn;
var AccountFlags = {
  none: 0,
  linked: 1,
  debits_must_not_exceed_credits: 2,
  credits_must_not_exceed_debits: 4,
  history: 8,
  imported: 16,
  closed: 32
};
var TransferFlags = {
  none: 0,
  linked: 1,
  pending: 2,
  post_pending_transfer: 4,
  void_pending_transfer: 8,
  balancing_debit: 16,
  balancing_credit: 32,
  closing_debit: 64,
  closing_credit: 128,
  imported: 256
};
var AccountFilterFlags = {
  none: 0,
  debits: 1,
  credits: 2,
  reversed: 4
};
var QueryFilterFlags = {
  none: 0,
  reversed: 1
};
var accountNameToId = new Map;
var idToName = new Map;
var idToType = new Map;
var ledgerIdToName = new Map;
var ledgerIdToAssetScale = new Map;
var nextAccountId = 10000n;
function resetAccountRegistry(startId = 10000n) {
  accountNameToId.clear();
  idToName.clear();
  idToType.clear();
  nextAccountId = startId;
}
function getIdToName() {
  return idToName;
}
function getIdToType() {
  return idToType;
}
function getLedgerIdToName() {
  return ledgerIdToName;
}
function getLedgerAssetScale(ledgerId) {
  return ledgerIdToAssetScale.get(ledgerId) ?? 0;
}
function setLedgerName(ledgerId, name) {
  ledgerIdToName.set(ledgerId, name);
}
function defineLedger(name, id, assetScale = 0) {
  ledgerIdToName.set(id, name);
  ledgerIdToAssetScale.set(id, assetScale);
  return id;
}
function getAccountId(name) {
  const id = accountNameToId.get(name);
  if (id === undefined)
    throw new Error(`Account "${name}" not found. Create it first.`);
  return id;
}
function registerAccountMeta(id, name, type) {
  accountNameToId.set(name, id);
  idToName.set(id, name);
  idToType.set(id, type);
}
function parseAccountFlags(s) {
  if (!s || s === "none")
    return 0;
  let r = 0;
  for (const p of s.split("|").map((x) => x.trim().toLowerCase())) {
    if (p === "linked")
      r |= AccountFlags.linked;
    else if (p === "debits_must_not_exceed_credits")
      r |= AccountFlags.debits_must_not_exceed_credits;
    else if (p === "credits_must_not_exceed_debits")
      r |= AccountFlags.credits_must_not_exceed_debits;
    else if (p === "history")
      r |= AccountFlags.history;
    else if (p === "imported")
      r |= AccountFlags.imported;
    else if (p === "closed")
      r |= AccountFlags.closed;
  }
  return r;
}
function parseTransferFlags(s) {
  if (!s || s === "none")
    return 0;
  let r = 0;
  for (const p of s.split("|").map((x) => x.trim().toLowerCase())) {
    if (p === "linked")
      r |= TransferFlags.linked;
    else if (p === "pending")
      r |= TransferFlags.pending;
    else if (p === "post_pending_transfer")
      r |= TransferFlags.post_pending_transfer;
    else if (p === "void_pending_transfer")
      r |= TransferFlags.void_pending_transfer;
    else if (p === "balancing_debit")
      r |= TransferFlags.balancing_debit;
    else if (p === "balancing_credit")
      r |= TransferFlags.balancing_credit;
    else if (p === "closing_debit")
      r |= TransferFlags.closing_debit;
    else if (p === "closing_credit")
      r |= TransferFlags.closing_credit;
  }
  return r;
}
function account(params) {
  let id;
  if (params.id !== undefined) {
    id = params.id;
  } else if (params.name) {
    const existing = accountNameToId.get(params.name);
    if (existing !== undefined) {
      id = existing;
    } else {
      id = nextAccountId++;
      accountNameToId.set(params.name, id);
      idToName.set(id, params.name);
    }
  } else {
    id = nextAccountId++;
  }
  if (params.name && !accountNameToId.has(params.name)) {
    accountNameToId.set(params.name, id);
    idToName.set(id, params.name);
  }
  idToType.set(id, params.type);
  const flags = typeof params.flags === "string" ? parseAccountFlags(params.flags) : params.flags ?? 0;
  return {
    id,
    debits_pending: 0n,
    debits_posted: 0n,
    credits_pending: 0n,
    credits_posted: 0n,
    user_data_128: 0n,
    user_data_64: 0n,
    user_data_32: 0,
    reserved: 0,
    ledger: params.ledger,
    code: params.code ?? 1,
    flags,
    timestamp: 0n
  };
}
function transfer(id, ledger, amount, dr, cr, flags, more) {
  const flagsStr = typeof flags === "string" ? flags : "";
  return {
    id,
    debit_account_id: getAccountId(dr),
    credit_account_id: getAccountId(cr),
    amount,
    pending_id: more?.pending_id ?? 0n,
    user_data_128: more?.user_data_128 ?? 0n,
    user_data_64: more?.user_data_64 ?? 0n,
    user_data_32: more?.user_data_32 ?? 0,
    timeout: 0,
    ledger,
    code: more?.code ?? 1,
    flags: typeof flags === "string" ? parseTransferFlags(flags) : flags ?? TransferFlags.none,
    timestamp: 0n,
    _meta: { dr, cr, flags: flagsStr, failsWith: more?.failsWith }
  };
}
var ACCOUNT_SIZE = 128;
var TRANSFER_SIZE = 128;
var ACCOUNT_FILTER_SIZE = 128;
var QUERY_FILTER_SIZE = 64;
var ACCOUNT_BALANCE_SIZE = 128;
var CREATE_ACCOUNT_RESULT_SIZE = 16;
var CREATE_TRANSFER_RESULT_SIZE = 16;
var TB_CLIENT_SIZE = 32;
var TB_PACKET_SIZE = 88;
var TB_PACKET_DATA = 8;
var TB_PACKET_DATA_SIZE = 16;
var TB_PACKET_OPERATION = 22;
var OP_LOOKUP_ACCOUNTS = 140;
var OP_LOOKUP_TRANSFERS = 141;
var OP_GET_ACCOUNT_TRANSFERS = 142;
var OP_GET_ACCOUNT_BALANCES = 143;
var OP_QUERY_ACCOUNTS = 144;
var OP_QUERY_TRANSFERS = 145;
var OP_CREATE_ACCOUNTS = 146;
var OP_CREATE_TRANSFERS = 147;
var TB_CREATED = 4294967295;
function writeU128(view, offset, val) {
  view.setBigUint64(offset, val & 0xffffffffffffffffn, true);
  view.setBigUint64(offset + 8, val >> 64n, true);
}
function readU128(view, offset) {
  const lo = view.getBigUint64(offset, true);
  const hi = view.getBigUint64(offset + 8, true);
  return lo | hi << 64n;
}
function writeAccount(view, offset, acc) {
  writeU128(view, offset + 0, acc.id);
  writeU128(view, offset + 16, acc.debits_pending);
  writeU128(view, offset + 32, acc.debits_posted);
  writeU128(view, offset + 48, acc.credits_pending);
  writeU128(view, offset + 64, acc.credits_posted);
  writeU128(view, offset + 80, acc.user_data_128);
  view.setBigUint64(offset + 96, acc.user_data_64, true);
  view.setUint32(offset + 104, acc.user_data_32, true);
  view.setUint32(offset + 108, acc.reserved, true);
  view.setUint32(offset + 112, acc.ledger, true);
  view.setUint16(offset + 116, acc.code, true);
  view.setUint16(offset + 118, acc.flags, true);
  view.setBigUint64(offset + 120, acc.timestamp, true);
}
function readAccount(view, offset) {
  return {
    id: readU128(view, offset + 0),
    debits_pending: readU128(view, offset + 16),
    debits_posted: readU128(view, offset + 32),
    credits_pending: readU128(view, offset + 48),
    credits_posted: readU128(view, offset + 64),
    user_data_128: readU128(view, offset + 80),
    user_data_64: view.getBigUint64(offset + 96, true),
    user_data_32: view.getUint32(offset + 104, true),
    reserved: view.getUint32(offset + 108, true),
    ledger: view.getUint32(offset + 112, true),
    code: view.getUint16(offset + 116, true),
    flags: view.getUint16(offset + 118, true),
    timestamp: view.getBigUint64(offset + 120, true)
  };
}
function writeTransfer(view, offset, t) {
  writeU128(view, offset + 0, t.id);
  writeU128(view, offset + 16, t.debit_account_id);
  writeU128(view, offset + 32, t.credit_account_id);
  writeU128(view, offset + 48, t.amount);
  writeU128(view, offset + 64, t.pending_id);
  writeU128(view, offset + 80, t.user_data_128);
  view.setBigUint64(offset + 96, t.user_data_64, true);
  view.setUint32(offset + 104, t.user_data_32, true);
  view.setUint32(offset + 108, t.timeout, true);
  view.setUint32(offset + 112, t.ledger, true);
  view.setUint16(offset + 116, t.code, true);
  view.setUint16(offset + 118, t.flags, true);
  view.setBigUint64(offset + 120, t.timestamp, true);
}
function readTransfer(view, offset) {
  return {
    id: readU128(view, offset + 0),
    debit_account_id: readU128(view, offset + 16),
    credit_account_id: readU128(view, offset + 32),
    amount: readU128(view, offset + 48),
    pending_id: readU128(view, offset + 64),
    user_data_128: readU128(view, offset + 80),
    user_data_64: view.getBigUint64(offset + 96, true),
    user_data_32: view.getUint32(offset + 104, true),
    timeout: view.getUint32(offset + 108, true),
    ledger: view.getUint32(offset + 112, true),
    code: view.getUint16(offset + 116, true),
    flags: view.getUint16(offset + 118, true),
    timestamp: view.getBigUint64(offset + 120, true)
  };
}
function writeAccountFilter(view, offset, f) {
  for (let i = 0;i < ACCOUNT_FILTER_SIZE; i++)
    view.setUint8(offset + i, 0);
  writeU128(view, offset + 0, f.account_id);
  writeU128(view, offset + 16, f.user_data_128 ?? 0n);
  view.setBigUint64(offset + 32, f.user_data_64 ?? 0n, true);
  view.setUint32(offset + 40, f.user_data_32 ?? 0, true);
  view.setUint16(offset + 44, f.code ?? 0, true);
  view.setBigUint64(offset + 104, f.timestamp_min ?? 0n, true);
  view.setBigUint64(offset + 112, f.timestamp_max ?? 0n, true);
  view.setUint32(offset + 120, f.limit, true);
  let flags = 0;
  if (f.flags.debits)
    flags |= 1;
  if (f.flags.credits)
    flags |= 2;
  if (f.flags.reversed)
    flags |= 4;
  view.setUint32(offset + 124, flags, true);
}
function writeQueryFilter(view, offset, f) {
  for (let i = 0;i < QUERY_FILTER_SIZE; i++)
    view.setUint8(offset + i, 0);
  writeU128(view, offset + 0, f.user_data_128 ?? 0n);
  view.setBigUint64(offset + 16, f.user_data_64 ?? 0n, true);
  view.setUint32(offset + 24, f.user_data_32 ?? 0, true);
  view.setUint32(offset + 28, f.ledger ?? 0, true);
  view.setUint16(offset + 32, f.code ?? 0, true);
  view.setBigUint64(offset + 40, f.timestamp_min ?? 0n, true);
  view.setBigUint64(offset + 48, f.timestamp_max ?? 0n, true);
  view.setUint32(offset + 56, f.limit, true);
  view.setUint32(offset + 60, f.flags?.reversed ? 1 : 0, true);
}
function readAccountBalance(view, offset) {
  return {
    debits_pending: readU128(view, offset + 0),
    debits_posted: readU128(view, offset + 16),
    credits_pending: readU128(view, offset + 32),
    credits_posted: readU128(view, offset + 48),
    timestamp: view.getBigUint64(offset + 64, true)
  };
}
var CREATE_ACCOUNT_RESULTS = {
  0: "deprecated_ok",
  1: "linked_event_failed",
  2: "linked_event_chain_open",
  3: "timestamp_must_be_zero",
  4: "reserved_field",
  5: "reserved_flag",
  6: "id_must_not_be_zero",
  7: "id_must_not_be_int_max",
  8: "flags_are_mutually_exclusive",
  9: "debits_pending_must_be_zero",
  10: "debits_posted_must_be_zero",
  11: "credits_pending_must_be_zero",
  12: "credits_posted_must_be_zero",
  13: "ledger_must_not_be_zero",
  14: "code_must_not_be_zero",
  15: "exists_with_different_flags",
  16: "exists_with_different_user_data_128",
  17: "exists_with_different_user_data_64",
  18: "exists_with_different_user_data_32",
  19: "exists_with_different_ledger",
  20: "exists_with_different_code",
  21: "exists",
  22: "imported_event_expected",
  23: "imported_event_not_expected",
  24: "imported_event_timestamp_out_of_range",
  25: "imported_event_timestamp_must_not_advance",
  26: "imported_event_timestamp_must_not_regress"
};
var CREATE_TRANSFER_RESULTS = {
  0: "deprecated_ok",
  1: "linked_event_failed",
  2: "linked_event_chain_open",
  3: "timestamp_must_be_zero",
  4: "reserved_flag",
  5: "id_must_not_be_zero",
  6: "id_must_not_be_int_max",
  7: "flags_are_mutually_exclusive",
  8: "debit_account_id_must_not_be_zero",
  9: "debit_account_id_must_not_be_int_max",
  10: "credit_account_id_must_not_be_zero",
  11: "credit_account_id_must_not_be_int_max",
  12: "accounts_must_be_different",
  13: "pending_id_must_be_zero",
  14: "pending_id_must_not_be_zero",
  15: "pending_id_must_not_be_int_max",
  16: "pending_id_must_be_different",
  17: "timeout_reserved_for_pending_transfer",
  18: "deprecated_18",
  19: "ledger_must_not_be_zero",
  20: "code_must_not_be_zero",
  21: "debit_account_not_found",
  22: "credit_account_not_found",
  23: "accounts_must_have_the_same_ledger",
  24: "transfer_must_have_the_same_ledger_as_accounts",
  25: "pending_transfer_not_found",
  26: "pending_transfer_not_pending",
  27: "pending_transfer_has_different_debit_account_id",
  28: "pending_transfer_has_different_credit_account_id",
  29: "pending_transfer_has_different_ledger",
  30: "pending_transfer_has_different_code",
  31: "exceeds_pending_transfer_amount",
  32: "pending_transfer_has_different_amount",
  33: "pending_transfer_already_posted",
  34: "pending_transfer_already_voided",
  35: "pending_transfer_expired",
  36: "exists_with_different_flags",
  37: "exists_with_different_debit_account_id",
  38: "exists_with_different_credit_account_id",
  39: "exists_with_different_amount",
  40: "exists_with_different_pending_id",
  41: "exists_with_different_user_data_128",
  42: "exists_with_different_user_data_64",
  43: "exists_with_different_user_data_32",
  44: "exists_with_different_timeout",
  45: "exists_with_different_code",
  46: "exists",
  47: "overflows_debits_pending",
  48: "overflows_credits_pending",
  49: "overflows_debits_posted",
  50: "overflows_credits_posted",
  51: "overflows_debits",
  52: "overflows_credits",
  53: "overflows_timeout",
  54: "exceeds_credits",
  55: "exceeds_debits",
  56: "imported_event_expected",
  57: "imported_event_not_expected",
  58: "imported_event_timestamp_out_of_range",
  59: "imported_event_timestamp_must_not_advance",
  60: "imported_event_timestamp_must_not_regress",
  61: "imported_event_timestamp_must_postdate_debit_account",
  62: "imported_event_timestamp_must_postdate_credit_account",
  63: "imported_event_timeout_must_be_zero",
  64: "closing_transfer_must_be_pending",
  65: "debit_account_already_closed",
  66: "credit_account_already_closed",
  67: "exists_with_different_ledger",
  68: "id_already_failed"
};

class WasmTigerbeetle {
  ex;
  clientPtr;
  pendingRef;
  constructor(instance, pendingRef) {
    this.ex = instance.exports;
    this.pendingRef = pendingRef;
    this.clientPtr = this.ex.tb_alloc(TB_CLIENT_SIZE);
    if (this.clientPtr === 0)
      throw new Error("tb_alloc failed: out of memory");
    const status = this.ex.tb_client_init(this.clientPtr, 0, 0, 0, 0, 0);
    if (status !== 0)
      throw new Error(`tb_client_init failed: status ${status}`);
  }
  static async load(wasmUrl) {
    let memory;
    const pendingRef = { value: null };
    const result = await WebAssembly.instantiateStreaming(fetch(wasmUrl), {
      env: {
        tb_env_realtime_ns: () => BigInt(Date.now()) * 1000000n,
        tb_env_log_str: (ptr, len) => {
          const bytes = new Uint8Array(memory.buffer, Number(ptr), len);
          console.log(new TextDecoder().decode(bytes));
        },
        tb_env_completion: (_ctx, _pkt, _ts, resultPtr, resultSize) => {
          pendingRef.value = resultSize > 0 ? new Uint8Array(memory.buffer, resultPtr, resultSize).slice() : new Uint8Array(0);
        }
      }
    });
    memory = result.instance.exports.memory;
    return new WasmTigerbeetle(result.instance, pendingRef);
  }
  reset() {
    this.ex.tb_client_deinit(this.clientPtr);
    const status = this.ex.tb_client_init(this.clientPtr, 0, 0, 0, 0, 0);
    if (status !== 0)
      throw new Error(`tb_client_init failed: status ${status}`);
  }
  view() {
    return new DataView(this.ex.memory.buffer);
  }
  alloc(size) {
    if (size === 0)
      return 0;
    const ptr = this.ex.tb_alloc(size);
    if (ptr === 0)
      throw new Error("WASM allocation failed: out of memory");
    return ptr;
  }
  submit(operation, dataPtr, dataSize) {
    const packetPtr = this.alloc(TB_PACKET_SIZE);
    try {
      const v = this.view();
      for (let i = 0;i < TB_PACKET_SIZE; i++)
        v.setUint8(packetPtr + i, 0);
      v.setUint32(packetPtr + TB_PACKET_DATA, dataPtr, true);
      v.setUint32(packetPtr + TB_PACKET_DATA_SIZE, dataSize, true);
      v.setUint8(packetPtr + TB_PACKET_OPERATION, operation);
      this.ex.tb_client_submit(this.clientPtr, packetPtr);
      const result = this.pendingRef.value ?? new Uint8Array(0);
      this.pendingRef.value = null;
      return result;
    } finally {
      this.ex.tb_free(packetPtr, TB_PACKET_SIZE);
    }
  }
  createAccounts(accounts) {
    const n = accounts.length;
    if (n === 0)
      return [];
    const dataSize = n * ACCOUNT_SIZE;
    const dataPtr = this.alloc(dataSize);
    try {
      const v = this.view();
      for (let i = 0;i < n; i++)
        writeAccount(v, dataPtr + i * ACCOUNT_SIZE, accounts[i]);
      const result = this.submit(OP_CREATE_ACCOUNTS, dataPtr, dataSize);
      const dv = new DataView(result.buffer);
      const errors = [];
      for (let i = 0;i < n; i++) {
        const base = i * CREATE_ACCOUNT_RESULT_SIZE;
        if (base + CREATE_ACCOUNT_RESULT_SIZE > result.byteLength)
          break;
        const status = dv.getUint32(base + 8, true);
        if (status !== TB_CREATED) {
          errors.push({ index: i, result: CREATE_ACCOUNT_RESULTS[status] ?? `error_${status}` });
        }
      }
      return errors;
    } finally {
      this.ex.tb_free(dataPtr, dataSize);
    }
  }
  createTransfers(transfers) {
    const n = transfers.length;
    if (n === 0)
      return [];
    const dataSize = n * TRANSFER_SIZE;
    const dataPtr = this.alloc(dataSize);
    try {
      const v = this.view();
      for (let i = 0;i < n; i++)
        writeTransfer(v, dataPtr + i * TRANSFER_SIZE, transfers[i]);
      const result = this.submit(OP_CREATE_TRANSFERS, dataPtr, dataSize);
      const dv = new DataView(result.buffer);
      const errors = [];
      for (let i = 0;i < n; i++) {
        const base = i * CREATE_TRANSFER_RESULT_SIZE;
        if (base + CREATE_TRANSFER_RESULT_SIZE > result.byteLength)
          break;
        const status = dv.getUint32(base + 8, true);
        if (status !== TB_CREATED) {
          errors.push({ index: i, result: CREATE_TRANSFER_RESULTS[status] ?? `error_${status}` });
        }
      }
      return errors;
    } finally {
      this.ex.tb_free(dataPtr, dataSize);
    }
  }
  getAllAccounts() {
    return this.queryAccounts({ limit: 8192 });
  }
  lookupAccounts(ids) {
    const n = ids.length;
    if (n === 0)
      return [];
    const dataSize = n * 16;
    const dataPtr = this.alloc(dataSize);
    try {
      const v = this.view();
      for (let i = 0;i < n; i++)
        writeU128(v, dataPtr + i * 16, ids[i]);
      const result = this.submit(OP_LOOKUP_ACCOUNTS, dataPtr, dataSize);
      const dv = new DataView(result.buffer);
      const count = result.byteLength / ACCOUNT_SIZE;
      const out = [];
      for (let i = 0;i < count; i++)
        out.push(readAccount(dv, i * ACCOUNT_SIZE));
      return out;
    } finally {
      this.ex.tb_free(dataPtr, dataSize);
    }
  }
  lookupTransfers(ids) {
    const n = ids.length;
    if (n === 0)
      return [];
    const dataSize = n * 16;
    const dataPtr = this.alloc(dataSize);
    try {
      const v = this.view();
      for (let i = 0;i < n; i++)
        writeU128(v, dataPtr + i * 16, ids[i]);
      const result = this.submit(OP_LOOKUP_TRANSFERS, dataPtr, dataSize);
      const dv = new DataView(result.buffer);
      const count = result.byteLength / TRANSFER_SIZE;
      const out = [];
      for (let i = 0;i < count; i++)
        out.push(readTransfer(dv, i * TRANSFER_SIZE));
      return out;
    } finally {
      this.ex.tb_free(dataPtr, dataSize);
    }
  }
  getAccountTransfers(filter) {
    const dataPtr = this.alloc(ACCOUNT_FILTER_SIZE);
    try {
      writeAccountFilter(this.view(), dataPtr, filter);
      const result = this.submit(OP_GET_ACCOUNT_TRANSFERS, dataPtr, ACCOUNT_FILTER_SIZE);
      const dv = new DataView(result.buffer);
      const count = result.byteLength / TRANSFER_SIZE;
      const out = [];
      for (let i = 0;i < count; i++)
        out.push(readTransfer(dv, i * TRANSFER_SIZE));
      return out;
    } finally {
      this.ex.tb_free(dataPtr, ACCOUNT_FILTER_SIZE);
    }
  }
  getAccountBalances(filter) {
    const dataPtr = this.alloc(ACCOUNT_FILTER_SIZE);
    try {
      writeAccountFilter(this.view(), dataPtr, filter);
      const result = this.submit(OP_GET_ACCOUNT_BALANCES, dataPtr, ACCOUNT_FILTER_SIZE);
      const dv = new DataView(result.buffer);
      const count = result.byteLength / ACCOUNT_BALANCE_SIZE;
      const out = [];
      for (let i = 0;i < count; i++)
        out.push(readAccountBalance(dv, i * ACCOUNT_BALANCE_SIZE));
      return out;
    } finally {
      this.ex.tb_free(dataPtr, ACCOUNT_FILTER_SIZE);
    }
  }
  queryAccounts(filter) {
    const dataPtr = this.alloc(QUERY_FILTER_SIZE);
    try {
      writeQueryFilter(this.view(), dataPtr, filter);
      const result = this.submit(OP_QUERY_ACCOUNTS, dataPtr, QUERY_FILTER_SIZE);
      const dv = new DataView(result.buffer);
      const count = result.byteLength / ACCOUNT_SIZE;
      const out = [];
      for (let i = 0;i < count; i++)
        out.push(readAccount(dv, i * ACCOUNT_SIZE));
      return out;
    } finally {
      this.ex.tb_free(dataPtr, QUERY_FILTER_SIZE);
    }
  }
  queryTransfers(filter) {
    const dataPtr = this.alloc(QUERY_FILTER_SIZE);
    try {
      writeQueryFilter(this.view(), dataPtr, filter);
      const result = this.submit(OP_QUERY_TRANSFERS, dataPtr, QUERY_FILTER_SIZE);
      const dv = new DataView(result.buffer);
      const count = result.byteLength / TRANSFER_SIZE;
      const out = [];
      for (let i = 0;i < count; i++)
        out.push(readTransfer(dv, i * TRANSFER_SIZE));
      return out;
    } finally {
      this.ex.tb_free(dataPtr, QUERY_FILTER_SIZE);
    }
  }
  destroy() {
    this.ex.tb_client_deinit(this.clientPtr);
    this.ex.tb_free(this.clientPtr, TB_CLIENT_SIZE);
  }
}

// src/playground/main.ts
function serializeAccountToJson(account2) {
  const obj = {
    id: account2.id.toString(),
    debits_pending: account2.debits_pending.toString(),
    debits_posted: account2.debits_posted.toString(),
    credits_pending: account2.credits_pending.toString(),
    credits_posted: account2.credits_posted.toString(),
    user_data_128: account2.user_data_128.toString(),
    user_data_64: account2.user_data_64.toString(),
    user_data_32: account2.user_data_32,
    reserved: account2.reserved,
    ledger: account2.ledger,
    code: account2.code,
    flags: account2.flags,
    timestamp: account2.timestamp.toString()
  };
  return JSON.stringify(obj, null, 2);
}
function formatJsonWithHighlighting(json) {
  return json.replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:').replace(/: "([^"]*)"/g, ': <span class="json-string">"$1"</span>').replace(/: (\d+)/g, ': <span class="json-number">$1</span>');
}
var runBtn = document.getElementById("run-btn");
var statusEl = document.getElementById("status");
var tAccountsTabsEl = document.getElementById("t-accounts-tabs");
var tAccountsContentEl = document.getElementById("t-accounts-content");
var logEl = document.getElementById("log");
var clearBtn = document.getElementById("clear-btn");
var dividerEl = document.getElementById("divider");
var editorPaneEl = document.getElementById("editor-pane");
var editorContainerEl = document.getElementById("editor-container");
var logDividerEl = document.getElementById("log-divider");
var logPaneEl = document.getElementById("log-pane");
var saveBtn = document.getElementById("save-btn");
var modeCodeBtn = document.getElementById("mode-code");
var modeSimpleBtn = document.getElementById("mode-simple");
var simpleUiContainer = document.getElementById("simple-ui-container");
var modeToggleEl = document.getElementById("mode-toggle");
var settingsBtn = document.getElementById("settings-btn");
var settingsOverlay = document.getElementById("settings-overlay");
var settingsCloseBtn = document.getElementById("settings-close-btn");
var settingsThemeSelect = document.getElementById("settings-theme");
var settingsSimpleModeToggle = document.getElementById("settings-simple-mode");
var settingsStepModeToggle = document.getElementById("settings-step-mode");
var settingsClearDataBtn = document.getElementById("settings-clear-data");
var sourceDropdown = document.getElementById("source-dropdown");
var sourceDropdownTrigger = document.getElementById("source-dropdown-trigger");
var sourceDropdownLabel = document.getElementById("source-dropdown-label");
var sourceDropdownMenu = document.getElementById("source-dropdown-menu");
var shareBtn = document.getElementById("share-btn");
var accountJsonPopover = document.getElementById("account-json-popover");
var accountJsonContent = document.getElementById("account-json-content");
var runDropdown = document.getElementById("run-dropdown");
var runDropdownTrigger = document.getElementById("run-dropdown-trigger");
var runDropdownMenu = document.getElementById("run-dropdown-menu");
var stepModeMenuItem = document.getElementById("step-mode-menu-item");
var stepControlsEl = document.getElementById("step-controls");
var stepCurrentEl = document.getElementById("step-current");
var stepTotalEl = document.getElementById("step-total");
var stepNextBtn = document.getElementById("step-next-btn");
var stepRunAllBtn = document.getElementById("step-run-all-btn");
var stepExitBtn = document.getElementById("step-exit-btn");
var SETTINGS_KEY = "coa-playground-settings";
var BROWSER_FILES_KEY = "coa-browser-files";
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function saveSettings(partial) {
  const current = loadSettings();
  const updated = { ...current, ...partial };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
}
function applySettings() {
  const s = loadSettings();
  if (s.editorWidth) {
    editorPaneEl.style.flex = "none";
    editorPaneEl.style.width = `${s.editorWidth}px`;
  }
  if (s.consoleHeight) {
    logPaneEl.style.height = `${s.consoleHeight}px`;
  }
  if (s.consoleHidden) {
    logPaneEl.style.display = "none";
    logDividerEl.style.display = "none";
  }
  if (s.consoleMaximized) {
    logPaneEl.classList.add("maximized");
    editorContainerEl.style.display = "none";
    logDividerEl.style.display = "none";
    logPaneEl.style.display = "";
  }
}
applySettings();
function openSettingsDialog() {
  const settings = loadSettings();
  settingsThemeSelect.value = settings.theme ?? "system";
  settingsSimpleModeToggle.classList.toggle("active", settings.simpleModeEnabled === true);
  settingsOverlay.classList.remove("hidden");
}
function closeSettingsDialog() {
  settingsOverlay.classList.add("hidden");
}
function applyTheme(theme) {
  const html = document.documentElement;
  html.classList.remove("theme-light", "theme-dark");
  if (theme === "light") {
    html.classList.add("theme-light");
  } else if (theme === "dark") {
    html.classList.add("theme-dark");
  }
  const monaco = window.monaco;
  if (monaco) {
    let monacoTheme = "coa-dark";
    if (theme === "light") {
      monacoTheme = "coa-light";
    } else if (theme === "dark") {
      monacoTheme = "coa-dark";
    } else {
      monacoTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "coa-dark" : "coa-light";
    }
    monaco.editor.setTheme(monacoTheme);
  }
}
function updateSimpleModeVisibility(enabled) {
  modeToggleEl.style.display = enabled ? "" : "none";
  if (!enabled) {
    const settings = loadSettings();
    if (settings.editorMode === "simple") {
      switchMode("code");
    }
  }
}
settingsBtn.addEventListener("click", openSettingsDialog);
settingsCloseBtn.addEventListener("click", closeSettingsDialog);
settingsOverlay.addEventListener("click", (e) => {
  if (e.target === settingsOverlay)
    closeSettingsDialog();
});
shareBtn.addEventListener("click", async () => {
  const code = monacoEditor.getValue();
  const encoded = await compressToUrl(code);
  const shareUrl = `${window.location.origin}${window.location.pathname}#code=${encoded}`;
  try {
    await navigator.clipboard.writeText(shareUrl);
    shareBtn.textContent = "Copied!";
    shareBtn.classList.add("copied");
    setTimeout(() => {
      shareBtn.textContent = "Share";
      shareBtn.classList.remove("copied");
    }, 2000);
  } catch (err) {
    prompt("Copy this link:", shareUrl);
  }
});
settingsThemeSelect.addEventListener("change", () => {
  const theme = settingsThemeSelect.value;
  saveSettings({ theme });
  applyTheme(theme);
});
settingsSimpleModeToggle.addEventListener("click", () => {
  const isActive = settingsSimpleModeToggle.classList.toggle("active");
  saveSettings({ simpleModeEnabled: isActive });
  updateSimpleModeVisibility(isActive);
});
settingsStepModeToggle.addEventListener("click", () => {
  const isActive = settingsStepModeToggle.classList.toggle("active");
  saveSettings({ stepModeEnabled: isActive });
  updateStepModeVisibility(isActive);
});
function updateStepModeVisibility(enabled) {
  stepModeMenuItem.style.display = enabled ? "" : "none";
  runDropdownTrigger.style.display = enabled ? "" : "none";
  runBtn.style.borderRadius = enabled ? "4px 0 0 4px" : "4px";
}
settingsClearDataBtn.addEventListener("click", () => {
  if (confirm("This will clear all settings, saved browser files, and reload the page. Continue?")) {
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(BROWSER_FILES_KEY);
    clearDirHandle();
    window.location.href = window.location.pathname;
  }
});
{
  const settings = loadSettings();
  applyTheme(settings.theme ?? "system");
  updateSimpleModeVisibility(settings.simpleModeEnabled === true);
  if (settings.simpleModeEnabled)
    settingsSimpleModeToggle.classList.add("active");
  updateStepModeVisibility(settings.stepModeEnabled === true);
  if (settings.stepModeEnabled)
    settingsStepModeToggle.classList.add("active");
}
var dirHandle = null;
var currentFileHandle = null;
var currentFileName = null;
var fileHandles = new Map;
var fileContents = new Map;
var hasUnsavedChanges = false;
var hasNativeFS = "showDirectoryPicker" in window;
var DB_NAME = "coa-playground";
var STORE_NAME = "handles";
async function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
  });
}
async function saveDirHandle(handle) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(handle, "dirHandle");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function loadDirHandle() {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get("dirHandle");
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}
async function clearDirHandle() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete("dirHandle");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function restoreFolderAccess() {
  if (!hasNativeFS)
    return;
  const handle = await loadDirHandle();
  if (!handle)
    return;
  try {
    const permission = await handle.requestPermission({ mode: "readwrite" });
    if (permission === "granted") {
      dirHandle = handle;
      await refreshFileList();
      updateSourceDropdown();
      setStatus(`Restored: ${handle.name}`, "ok");
    }
  } catch (err) {
    await clearDirHandle();
  }
}
restoreFolderAccess();
async function openFolder() {
  if (hasNativeFS) {
    await openFolderNative();
  } else {
    openFolderFallback();
  }
}
async function openFolderNative() {
  try {
    dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    await saveDirHandle(dirHandle);
    await refreshFileList();
    updateSourceDropdown();
    setStatus(`Opened: ${dirHandle.name}`, "ok");
  } catch (err) {
    if (err.name === "AbortError")
      return;
    console.error("Failed to open folder:", err);
    setStatus("Failed to open folder", "error");
    log(`Error: ${err.message}`, "error");
  }
}
function openFolderFallback() {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = ".ts";
  input.webkitdirectory = true;
  input.onchange = async () => {
    if (!input.files || input.files.length === 0)
      return;
    fileContents.clear();
    const files = [];
    for (let i = 0;i < input.files.length; i++) {
      const file = input.files[i];
      if (file && file.name.endsWith(".ts")) {
        files.push(file);
      }
    }
    files.sort((a, b) => a.name.localeCompare(b.name));
    for (const file of files) {
      const content = await file.text();
      fileContents.set(file.name, content);
    }
    if (files.length > 0) {
      const settings = loadSettings();
      const fileToLoad = settings.lastFileName && fileContents.has(settings.lastFileName) ? settings.lastFileName : files[0].name;
      loadFileFallback(fileToLoad);
      updateSourceDropdown();
      setStatus(`Loaded ${files.length} files (read-only)`, "ok");
      log("Note: Firefox can only read files. Use Chrome/Edge for write access.", "warn");
    }
  };
  input.click();
}
async function refreshFileList() {
  if (!dirHandle)
    return;
  fileHandles.clear();
  const files = [];
  for await (const entry of dirHandle.values()) {
    if (entry.kind === "file" && entry.name.endsWith(".ts")) {
      fileHandles.set(entry.name, entry);
      files.push(entry.name);
    }
  }
  files.sort();
  if (files.length > 0 && !currentFileHandle) {
    const settings = loadSettings();
    const fileToLoad = settings.lastFileName && fileHandles.has(settings.lastFileName) ? settings.lastFileName : files[0];
    await loadFile(fileToLoad);
  }
  updateSourceDropdown();
}
async function loadFile(name) {
  if (!hasNativeFS) {
    loadFileFallback(name);
    return;
  }
  const handle = fileHandles.get(name);
  if (!handle)
    return;
  if (hasUnsavedChanges && currentFileHandle) {
    const discard = confirm(`Discard unsaved changes to ${currentFileHandle.name}?`);
    if (!discard) {
      return;
    }
  }
  try {
    const file = await handle.getFile();
    const content = await file.text();
    hideWelcomeScreen();
    monacoEditor.setValue(content);
    currentFileHandle = handle;
    currentFileName = name;
    currentSource = { type: "file", id: name, label: name };
    hasUnsavedChanges = false;
    updateSaveButton();
    saveBtn.style.display = "";
    updateSourceDropdown();
    const url = new URL(window.location.href);
    url.searchParams.delete("recipe");
    url.hash = "";
    window.history.replaceState(null, "", url.toString());
    saveSettings({ lastFileName: name });
    setStatus(`Loaded: ${name}`, "ok");
  } catch (err) {
    setStatus(`Failed to load ${name}`, "error");
  }
}
function loadFileFallback(name) {
  if (hasUnsavedChanges && currentFileName) {
    const discard = confirm(`Discard unsaved changes to ${currentFileName}?`);
    if (!discard) {
      return;
    }
  }
  const content = fileContents.get(name);
  if (content === undefined)
    return;
  hideWelcomeScreen();
  monacoEditor.setValue(content);
  currentFileName = name;
  currentSource = { type: "file", id: name, label: name };
  hasUnsavedChanges = false;
  updateSaveButton();
  saveBtn.style.display = "";
  updateSourceDropdown();
  saveSettings({ lastFileName: name });
  setStatus(`Loaded: ${name}`, "ok");
}
async function saveCurrentFile() {
  const isSharedCode = currentSource.type === "recipe" && !currentSource.id;
  if (isWelcomeScreen || isSharedCode) {
    const existingFiles = getBrowserFiles();
    let num = 1;
    let filename = "untitled.ts";
    while (existingFiles.includes(filename)) {
      num++;
      filename = `untitled${num}.ts`;
    }
    const content = monacoEditor.getValue();
    saveBrowserFile(filename, content);
    isWelcomeScreen = false;
    currentSource = { type: "browser", id: filename, label: filename };
    currentBrowserFileName = filename;
    hasUnsavedChanges = false;
    updateSaveButton();
    updateSourceDropdown();
    saveSettings({ lastBrowserFile: filename });
    setStatus(`Saved: ${filename}`, "ok");
    return;
  }
  if (currentSource.type === "browser" && currentBrowserFileName) {
    saveCurrentBrowserFile();
    return;
  }
  if (hasNativeFS) {
    if (!currentFileHandle)
      return;
    try {
      const writable = await currentFileHandle.createWritable();
      await writable.write(monacoEditor.getValue());
      await writable.close();
      hasUnsavedChanges = false;
      updateSaveButton();
      setStatus(`Saved: ${currentFileHandle.name}`, "ok");
    } catch (err) {
      setStatus("Failed to save", "error");
    }
  } else {
    if (!currentFileName)
      return;
    const content = monacoEditor.getValue();
    const blob = new Blob([content], { type: "text/typescript" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = currentFileName;
    a.click();
    URL.revokeObjectURL(url);
    fileContents.set(currentFileName, content);
    hasUnsavedChanges = false;
    updateSaveButton();
    setStatus(`Downloaded: ${currentFileName}`, "ok");
  }
}
async function createNewFile() {
  const name = prompt("New file name (without .ts):");
  if (!name)
    return;
  const fileName = name.endsWith(".ts") ? name : `${name}.ts`;
  const caseName = name.replace(/[^a-zA-Z0-9]/g, "_");
  const defaultContent = `// Define ledgers
const CASH = defineLedger("CASH", 1);

// ─── ${caseName} ────────────────────────────────────────────────────────────
async function ${caseName}() {
  resetAccountRegistry(1000n, "${caseName}");
  const ctx = new CaseContext();

  // Create accounts
  await ctx.createAccounts([
    account({ name: "bank", ledger: CASH, type: "Asset" }),
    account({ name: "customer:alice", ledger: CASH, type: "Liability", flags: "debits_must_not_exceed_credits" }),
    account({ name: "customer:bob", ledger: CASH, type: "Liability", flags: "debits_must_not_exceed_credits" }),
  ]);

  // Batch 0: Fund Alice's account
  await ctx.batch(0, "Fund Alice's account with 1000", [
    transfer(1000n, CASH, 1000n, "bank", "customer:alice"),
  ]);

  // Batch 1: Alice sends 250 to Bob
  await ctx.batch(1, "Alice sends 250 to Bob", [
    transfer(1001n, CASH, 250n, "customer:alice", "customer:bob"),
  ]);

  // Query final balances
  const accounts = tb.queryAccounts({ ledger: CASH, limit: 10 });
  console.log("Final accounts:", accounts);
}

await ${caseName}();
`;
  if (hasNativeFS) {
    if (!dirHandle)
      return;
    try {
      const handle = await dirHandle.getFileHandle(fileName, { create: true });
      const writable = await handle.createWritable();
      await writable.write(defaultContent);
      await writable.close();
      fileHandles.set(fileName, handle);
      await refreshFileList();
      await loadFile(fileName);
      setStatus(`Created: ${fileName}`, "ok");
    } catch (err) {
      setStatus("Failed to create file", "error");
    }
  } else {
    fileContents.set(fileName, defaultContent);
    loadFileFallback(fileName);
    updateSourceDropdown();
    setStatus(`Created: ${fileName} (in memory)`, "ok");
  }
}
function updateSaveButton() {
  saveBtn.textContent = hasUnsavedChanges ? "Save*" : "Save";
}
saveBtn.addEventListener("click", () => void saveCurrentFile());
var tAccountsTabs = [];
var activeTabId = null;
var tabCounter = 0;
var currentCaseName = null;
function createTab(name) {
  const id = `tab-${++tabCounter}`;
  const tabEl = document.createElement("button");
  tabEl.className = "t-accounts-tab";
  tabEl.textContent = name;
  tabEl.addEventListener("click", () => switchToTab(id));
  const panelEl = document.createElement("div");
  panelEl.className = "t-accounts-panel";
  panelEl.id = id;
  const tab = { id, name, tabEl, panelEl, accountSnapshots: new Map };
  tAccountsTabs.push(tab);
  tAccountsTabsEl.appendChild(tabEl);
  tAccountsContentEl.appendChild(panelEl);
  switchToTab(id);
  return tab;
}
function switchToTab(id) {
  for (const tab of tAccountsTabs) {
    const isActive = tab.id === id;
    tab.tabEl.classList.toggle("active", isActive);
    tab.panelEl.classList.toggle("active", isActive);
  }
  activeTabId = id;
}
function getActivePanel() {
  const tab = tAccountsTabs.find((t) => t.id === activeTabId);
  return tab?.panelEl ?? null;
}
function clearAllTabsExceptCurrent() {
  const currentTab = tAccountsTabs.find((t) => t.id === activeTabId);
  for (const tab of [...tAccountsTabs]) {
    if (tab.id !== activeTabId) {
      tab.tabEl.remove();
      tab.panelEl.remove();
      const idx = tAccountsTabs.indexOf(tab);
      if (idx !== -1)
        tAccountsTabs.splice(idx, 1);
    }
  }
  if (currentTab) {
    currentTab.panelEl.innerHTML = "";
  }
}
dividerEl.addEventListener("mousedown", (e) => {
  e.preventDefault();
  const startX = e.clientX;
  const startWidth = editorPaneEl.offsetWidth;
  dividerEl.classList.add("dragging");
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  const onMove = (e2) => {
    const minWidth = 200;
    const maxWidth = window.innerWidth - 200 - dividerEl.offsetWidth;
    const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + e2.clientX - startX));
    editorPaneEl.style.flex = "none";
    editorPaneEl.style.width = `${newWidth}px`;
  };
  const onUp = () => {
    dividerEl.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    saveSettings({ editorWidth: editorPaneEl.offsetWidth });
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
});
logDividerEl.addEventListener("mousedown", (e) => {
  e.preventDefault();
  const startY = e.clientY;
  const startHeight = logPaneEl.offsetHeight;
  logDividerEl.classList.add("dragging");
  document.body.style.cursor = "row-resize";
  document.body.style.userSelect = "none";
  const onMove = (e2) => {
    const newHeight = Math.max(40, Math.min(editorPaneEl.offsetHeight - 100, startHeight - (e2.clientY - startY)));
    logPaneEl.style.height = `${newHeight}px`;
  };
  const onUp = () => {
    logDividerEl.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    saveSettings({ consoleHeight: logPaneEl.offsetHeight });
  };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
});
var monacoEditor = await window.__monacoReady;
var WELCOME_CODE = `// Welcome to TigerBeetle's Playground.
// Select from an existing recipe, open a folder, or create a new file to get started.
`;
var isWelcomeScreen = false;
function showWelcomeScreen() {
  monacoEditor.setValue(WELCOME_CODE);
  isWelcomeScreen = true;
  currentSource = { type: "recipe", label: "Welcome" };
  currentBrowserFileName = null;
  hasUnsavedChanges = false;
  saveBtn.style.display = "";
  updateSaveButton();
  updateSourceDropdown();
}
function hideWelcomeScreen() {
  isWelcomeScreen = false;
}
window.__editor = monacoEditor;
{
  const settings = loadSettings();
  applyTheme(settings.theme ?? "system");
}
async function compressToUrl(str) {
  const stream = new Blob([str]).stream().pipeThrough(new CompressionStream("gzip"));
  const compressed = await new Response(stream).arrayBuffer();
  const binary = String.fromCharCode(...new Uint8Array(compressed));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function decompressFromUrl(encoded) {
  try {
    let base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4)
      base64 += "=";
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
  } catch {
    return null;
  }
}
async function getCodeFromUrl() {
  const hash = window.location.hash;
  if (!hash.startsWith("#code="))
    return null;
  const encoded = hash.slice(6);
  return decompressFromUrl(encoded);
}
function getRecipeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("recipe");
}
function setRecipeInUrl(recipeId) {
  const url = new URL(window.location.href);
  if (recipeId && recipeId !== "default") {
    url.searchParams.set("recipe", recipeId);
    url.hash = "";
  } else {
    url.searchParams.delete("recipe");
  }
  window.history.replaceState(null, "", url.toString());
}
var currentSource = { type: "recipe", id: "default", label: "Cash Authorization" };
function loadRecipe(recipeId) {
  const recipe = getRecipeById(recipeId);
  if (!recipe)
    return;
  hideWelcomeScreen();
  monacoEditor.setValue(recipe.code);
  currentSource = { type: "recipe", id: recipe.id, label: recipe.name };
  setRecipeInUrl(recipe.id);
  updateSourceDropdown();
  saveBtn.style.display = "none";
  hasUnsavedChanges = false;
  setStatus(`Loaded: ${recipe.name}`, "ok");
}
function getBrowserFileStore() {
  try {
    const stored = localStorage.getItem(BROWSER_FILES_KEY);
    if (stored)
      return JSON.parse(stored);
  } catch {}
  return { files: {} };
}
function saveBrowserFileStore(store) {
  localStorage.setItem(BROWSER_FILES_KEY, JSON.stringify(store));
}
function getBrowserFiles() {
  return Object.keys(getBrowserFileStore().files).sort();
}
function getBrowserFileContent(name) {
  return getBrowserFileStore().files[name];
}
function saveBrowserFile(name, content) {
  const store = getBrowserFileStore();
  store.files[name] = content;
  saveBrowserFileStore(store);
}
function deleteBrowserFile(name) {
  const store = getBrowserFileStore();
  delete store.files[name];
  saveBrowserFileStore(store);
}
function renameBrowserFile(oldName, newName) {
  if (!newName || newName === oldName)
    return false;
  if (!newName.endsWith(".ts"))
    newName += ".ts";
  const store = getBrowserFileStore();
  if (store.files[newName]) {
    alert(`File "${newName}" already exists`);
    return false;
  }
  const content = store.files[oldName];
  if (content === undefined)
    return false;
  delete store.files[oldName];
  store.files[newName] = content;
  saveBrowserFileStore(store);
  if (currentBrowserFileName === oldName) {
    currentBrowserFileName = newName;
    currentSource = { type: "browser", id: newName, label: newName };
    saveSettings({ lastBrowserFile: newName });
  }
  return true;
}
function createBrowserFile() {
  const existingFiles = getBrowserFiles();
  let num = 1;
  let filename = "untitled.ts";
  while (existingFiles.includes(filename)) {
    num++;
    filename = `untitled${num}.ts`;
  }
  const newCode = `// ${filename}
// Define your ledgers
const LEDGER = defineLedger("LEDGER", 1);

// Create a case function
async function myCase() {
  resetAccountRegistry(1000n, "myCase");
  const ctx = new CaseContext();

  // Define accounts
  await ctx.createAccounts([
    account({ name: "account1", ledger: LEDGER, type: "Asset", flags: "" }),
    account({ name: "account2", ledger: LEDGER, type: "Liability", flags: "" }),
  ]);

  // Create transfers
  await ctx.batch(0, "Initial transfer", [
    transfer(1001n, LEDGER, 100n, "account1", "account2"),
  ]);
}

await myCase();
`;
  saveBrowserFile(filename, newCode);
  loadBrowserFile(filename);
  setStatus(`Created: ${filename}`, "ok");
}
function loadBrowserFile(name) {
  const content = getBrowserFileContent(name);
  if (content === undefined)
    return;
  hideWelcomeScreen();
  monacoEditor.setValue(content);
  currentSource = { type: "browser", id: name, label: name };
  currentBrowserFileName = name;
  const url = new URL(window.location.href);
  url.searchParams.delete("recipe");
  url.hash = "";
  window.history.replaceState(null, "", url.toString());
  updateSourceDropdown();
  saveBtn.style.display = "";
  hasUnsavedChanges = false;
  updateSaveButton();
  saveSettings({ lastBrowserFile: name });
  setStatus(`Loaded: ${name}`, "ok");
}
function saveCurrentBrowserFile() {
  if (currentSource.type !== "browser" || !currentBrowserFileName)
    return;
  saveBrowserFile(currentBrowserFileName, monacoEditor.getValue());
  hasUnsavedChanges = false;
  updateSaveButton();
  setStatus(`Saved: ${currentBrowserFileName}`, "ok");
}
var currentBrowserFileName = null;
function updateSourceDropdown() {
  sourceDropdownLabel.textContent = currentSource.label;
  renderSourceDropdownMenu();
}
function renderSourceDropdownMenu() {
  sourceDropdownMenu.innerHTML = "";
  const newBrowserFileItem = createDropdownItem("+ New File", "new-browser-file", false);
  newBrowserFileItem.classList.add("action");
  newBrowserFileItem.addEventListener("click", () => {
    closeSourceDropdown();
    createBrowserFile();
  });
  sourceDropdownMenu.appendChild(newBrowserFileItem);
  sourceDropdownMenu.appendChild(createSeparator());
  const browserFiles = getBrowserFiles();
  if (browserFiles.length > 0) {
    const browserHeader = document.createElement("div");
    browserHeader.className = "source-dropdown-section";
    browserHeader.textContent = "My Browser";
    sourceDropdownMenu.appendChild(browserHeader);
    for (const filename of browserFiles) {
      const isActive = currentSource.type === "browser" && currentSource.id === filename;
      const item = createBrowserFileDropdownItem(filename, isActive);
      sourceDropdownMenu.appendChild(item);
    }
    sourceDropdownMenu.appendChild(createSeparator());
  }
  const recipesHeader = document.createElement("div");
  recipesHeader.className = "source-dropdown-section";
  recipesHeader.textContent = "Recipes";
  sourceDropdownMenu.appendChild(recipesHeader);
  for (const recipe of RECIPES) {
    const isActive = currentSource.type === "recipe" && currentSource.id === recipe.id;
    const item = createDropdownItem(recipe.name, "recipe", isActive);
    item.title = recipe.description;
    item.addEventListener("click", () => {
      closeSourceDropdown();
      loadRecipe(recipe.id);
    });
    sourceDropdownMenu.appendChild(item);
  }
  sourceDropdownMenu.appendChild(createSeparator());
  const hasFolder = dirHandle || fileContents.size > 0;
  if (hasFolder) {
    const folderHeader = document.createElement("div");
    folderHeader.className = "source-dropdown-section";
    folderHeader.textContent = dirHandle ? dirHandle.name : "Files";
    sourceDropdownMenu.appendChild(folderHeader);
    const files = dirHandle ? Array.from(fileHandles.keys()).sort() : Array.from(fileContents.keys()).sort();
    for (const filename of files) {
      const isActive = currentSource.type === "file" && currentSource.id === filename;
      const item = createDropdownItem(filename, "file", isActive);
      item.addEventListener("click", () => {
        closeSourceDropdown();
        loadFile(filename);
      });
      sourceDropdownMenu.appendChild(item);
    }
    const newFileItem = createDropdownItem("+ New File", "new-file", false);
    newFileItem.classList.add("action");
    newFileItem.addEventListener("click", () => {
      closeSourceDropdown();
      createNewFile();
    });
    sourceDropdownMenu.appendChild(newFileItem);
    sourceDropdownMenu.appendChild(createSeparator());
    const closeItem = createDropdownItem("Close Folder", "close", false);
    closeItem.classList.add("danger");
    closeItem.addEventListener("click", () => {
      closeSourceDropdown();
      closeFolder();
    });
    sourceDropdownMenu.appendChild(closeItem);
  }
  const openFolderItem = createDropdownItem(hasFolder ? "Open Different Folder..." : "Open Folder...", "folder", false);
  openFolderItem.addEventListener("click", () => {
    closeSourceDropdown();
    openFolder();
  });
  sourceDropdownMenu.appendChild(openFolderItem);
}
function createDropdownItem(label, type, active) {
  const item = document.createElement("div");
  item.className = "source-dropdown-item" + (active ? " active" : "");
  const check = document.createElement("span");
  check.className = "check";
  check.textContent = active ? "✓" : "";
  item.appendChild(check);
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = label;
  item.appendChild(name);
  return item;
}
function createBrowserFileDropdownItem(filename, active) {
  const item = document.createElement("div");
  item.className = "source-dropdown-item" + (active ? " active" : "");
  const check = document.createElement("span");
  check.className = "check";
  check.textContent = active ? "✓" : "";
  item.appendChild(check);
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = filename;
  item.appendChild(name);
  const actions = document.createElement("span");
  actions.className = "item-actions";
  const renameBtn = document.createElement("button");
  renameBtn.className = "item-action-btn";
  renameBtn.title = "Rename";
  renameBtn.textContent = "✎";
  renameBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const newName = prompt("Rename file:", filename);
    if (newName && newName !== filename) {
      if (renameBrowserFile(filename, newName)) {
        updateSourceDropdown();
        setStatus(`Renamed to: ${newName.endsWith(".ts") ? newName : newName + ".ts"}`, "ok");
      }
    }
  });
  actions.appendChild(renameBtn);
  const deleteBtn = document.createElement("button");
  deleteBtn.className = "item-action-btn danger";
  deleteBtn.title = "Delete";
  deleteBtn.textContent = "✕";
  deleteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (confirm(`Delete "${filename}"?`)) {
      deleteBrowserFile(filename);
      if (currentBrowserFileName === filename) {
        const defaultRecipe = getDefaultRecipe();
        monacoEditor.setValue(defaultRecipe.code);
        currentSource = { type: "recipe", id: defaultRecipe.id, label: defaultRecipe.name };
        currentBrowserFileName = null;
        saveBtn.style.display = "none";
        saveSettings({ lastBrowserFile: undefined });
      }
      updateSourceDropdown();
      setStatus(`Deleted: ${filename}`, "ok");
    }
  });
  actions.appendChild(deleteBtn);
  item.appendChild(actions);
  item.addEventListener("click", (e) => {
    if (e.target.closest(".item-actions"))
      return;
    closeSourceDropdown();
    loadBrowserFile(filename);
  });
  return item;
}
function createSeparator() {
  const sep = document.createElement("div");
  sep.className = "source-dropdown-separator";
  return sep;
}
function openSourceDropdown() {
  renderSourceDropdownMenu();
  sourceDropdown.classList.add("open");
}
function closeSourceDropdown() {
  sourceDropdown.classList.remove("open");
}
function toggleSourceDropdown() {
  if (sourceDropdown.classList.contains("open")) {
    closeSourceDropdown();
  } else {
    openSourceDropdown();
  }
}
function closeFolder() {
  dirHandle = null;
  currentFileHandle = null;
  currentFileName = null;
  fileHandles.clear();
  fileContents.clear();
  clearDirHandle();
  hasUnsavedChanges = false;
  updateSaveButton();
  if (currentSource.type === "file") {
    showWelcomeScreen();
  }
  setStatus("Folder closed", "ok");
}
sourceDropdownTrigger.addEventListener("click", toggleSourceDropdown);
document.addEventListener("click", (e) => {
  if (!sourceDropdown.contains(e.target)) {
    closeSourceDropdown();
  }
});
updateSourceDropdown();
var urlRecipeId = getRecipeFromUrl();
var urlRecipe = urlRecipeId ? getRecipeById(urlRecipeId) : null;
var hashCode = await getCodeFromUrl();
var savedSettings = loadSettings();
var lastBrowserFile = savedSettings.lastBrowserFile;
var lastBrowserFileContent = lastBrowserFile ? getBrowserFileContent(lastBrowserFile) : undefined;
var isFirstVisit = !savedSettings.hasVisited;
var initialCode = null;
if (urlRecipe) {
  initialCode = urlRecipe.code;
  currentSource = { type: "recipe", id: urlRecipe.id, label: urlRecipe.name };
} else if (hashCode) {
  initialCode = hashCode;
  currentSource = { type: "recipe", label: "Shared" };
} else if (lastBrowserFile && lastBrowserFileContent !== undefined) {
  initialCode = lastBrowserFileContent;
  currentSource = { type: "browser", id: lastBrowserFile, label: lastBrowserFile };
  currentBrowserFileName = lastBrowserFile;
  saveBtn.style.display = "";
} else if (isFirstVisit) {
  showWelcomeScreen();
  saveSettings({ hasVisited: true });
} else {
  showWelcomeScreen();
}
if (initialCode !== null) {
  monacoEditor.setValue(initialCode);
}
updateSourceDropdown();
function foldCaseFunctions() {
  const model = monacoEditor.getModel();
  if (!model)
    return;
  const lines = model.getLinesContent();
  const linesToFold = [];
  for (let i = 0;i < lines.length; i++) {
    if (/^async function case\d+_\d+/.test(lines[i])) {
      linesToFold.push(i + 1);
    }
  }
  for (const lineNum of linesToFold.reverse()) {
    monacoEditor.setSelection({ startLineNumber: lineNum, startColumn: 1, endLineNumber: lineNum, endColumn: 1 });
    monacoEditor.trigger("keyboard", "editor.fold", {});
  }
  monacoEditor.setPosition({ lineNumber: 1, column: 1 });
  monacoEditor.revealLineInCenter(1);
}
setTimeout(foldCaseFunctions, 500);
monacoEditor.onDidChangeModelContent(() => {
  if (!hasUnsavedChanges && (currentFileHandle || currentBrowserFileName || isWelcomeScreen)) {
    hasUnsavedChanges = true;
    updateSaveButton();
  }
  if (stepMode.isActive()) {
    stepMode.exit();
    setStatus("Code modified - step mode stopped", "ok");
  }
});
var transferLineDec = monacoEditor.createDecorationsCollection([]);
var m = window.monaco;
monacoEditor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.Enter, () => runBtn.click());
monacoEditor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyJ, () => toggleConsole());
monacoEditor.addCommand(m.KeyMod.CtrlCmd | m.KeyMod.Shift | m.KeyCode.KeyJ, () => toggleConsoleMaximize());
monacoEditor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyD, () => {
  monacoEditor.trigger("keyboard", "editor.action.copyLinesDownAction", null);
});
monacoEditor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => {
  if (currentFileHandle || currentBrowserFileName || isWelcomeScreen) {
    saveCurrentFile();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey) {
    switch (e.key) {
      case "s":
        e.preventDefault();
        if (currentFileHandle || currentBrowserFileName || isWelcomeScreen) {
          saveCurrentFile();
        }
        break;
      case "o":
        e.preventDefault();
        openFolder();
        break;
      case "j":
        e.preventDefault();
        if (e.shiftKey) {
          toggleConsoleMaximize();
        } else {
          toggleConsole();
        }
        break;
      case "Enter":
        e.preventDefault();
        runBtn.click();
        break;
    }
  }
});
var currentMode = "code";
var simpleUI = new SimpleUI(simpleUiContainer, (model) => {
  const newCode = generatePlaygroundCode(model);
  const fullRange = monacoEditor.getModel()?.getFullModelRange();
  if (fullRange) {
    monacoEditor.getModel()?.pushEditOperations([], [{ range: fullRange, text: newCode }], () => null);
  }
});
function switchMode(mode) {
  if (mode === currentMode)
    return;
  currentMode = mode;
  modeCodeBtn.classList.toggle("active", mode === "code");
  modeSimpleBtn.classList.toggle("active", mode === "simple");
  if (mode === "code") {
    editorContainerEl.style.display = "";
    simpleUiContainer.style.display = "none";
  } else {
    const code = monacoEditor.getValue();
    try {
      const model = parsePlaygroundCode(code);
      simpleUI.setModel(model);
      setStatus("Ready", "ok");
    } catch (err) {
      setStatus("Parse error", "error");
      log(`Failed to parse code: ${err}`, "error");
    }
    editorContainerEl.style.display = "none";
    simpleUiContainer.style.display = "";
  }
  saveSettings({ editorMode: mode });
}
modeCodeBtn.addEventListener("click", () => switchMode("code"));
modeSimpleBtn.addEventListener("click", () => switchMode("simple"));
var savedMode = loadSettings().editorMode;
if (savedMode === "simple") {
  setTimeout(() => switchMode("simple"), 600);
}
function toggleConsole() {
  if (logPaneEl.classList.contains("maximized")) {
    toggleConsoleMaximize();
    return;
  }
  const isHidden = logPaneEl.style.display === "none";
  logPaneEl.style.display = isHidden ? "" : "none";
  logDividerEl.style.display = isHidden ? "" : "none";
  saveSettings({ consoleHidden: !isHidden, consoleMaximized: false });
}
function toggleConsoleMaximize() {
  const isMaximized = logPaneEl.classList.toggle("maximized");
  const currentMode2 = loadSettings().editorMode || "code";
  editorContainerEl.style.display = isMaximized ? "none" : currentMode2 === "code" ? "" : "none";
  simpleUiContainer.style.display = isMaximized ? "none" : currentMode2 === "simple" ? "" : "none";
  logDividerEl.style.display = isMaximized ? "none" : "";
  if (isMaximized) {
    logPaneEl.style.display = "";
  }
  saveSettings({ consoleMaximized: isMaximized, consoleHidden: false });
}
setStatus("Loading…", "running");
var tb;
try {
  tb = await WasmTigerbeetle.load(tigerbeetle_default);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  const isMemory64 = msg.includes("Memory64") || msg.includes("memory64");
  setStatus("Browser not supported", "error");
  log(isMemory64 ? "This playground requires WebAssembly Memory64, which is not supported by your browser. " + "Please use a recent version of Chrome, Firefox, or Edge." : `Failed to load TigerBeetle: ${msg}`, "error");
  throw err;
}
setStatus("Ready", "ok");
runBtn.addEventListener("click", () => void runCode());
clearBtn.addEventListener("click", () => {
  logEl.innerHTML = "";
  clearAllTabsExceptCurrent();
  setStatus("Cleared", "ok");
});
runDropdownTrigger.addEventListener("click", (e) => {
  e.stopPropagation();
  runDropdown.classList.toggle("open");
});
document.addEventListener("click", (e) => {
  if (!runDropdown.contains(e.target)) {
    runDropdown.classList.remove("open");
  }
});
runDropdownMenu.addEventListener("click", (e) => {
  const item = e.target.closest(".run-dropdown-item");
  if (!item)
    return;
  runDropdown.classList.remove("open");
  const action = item.dataset.action;
  if (action === "step") {
    runCode(true);
  } else {
    runCode(false);
  }
});
stepNextBtn.addEventListener("click", async () => {
  const hasMore = await stepMode.nextStep();
  if (!hasMore) {
    stepMode.exit();
    setStatus("Done", "ok");
  }
});
stepRunAllBtn.addEventListener("click", async () => {
  await stepMode.runAll();
  setStatus("Done", "ok");
});
stepExitBtn.addEventListener("click", () => {
  stepMode.exit();
  setStatus("Stopped", "ok");
});
document.addEventListener("keydown", (e) => {
  if (stepMode.isActive()) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      stepNextBtn.click();
    } else if (e.key === "Escape") {
      e.preventDefault();
      stepExitBtn.click();
    }
  }
});
async function preprocessCode(code) {
  const hasTS = /^import\b/m.test(code) || /\bexport\s+default\b/.test(code);
  if (!hasTS)
    return code;
  const uri = m.Uri.parse("file:///playground-recipe-temp.ts");
  const tsModel = m.editor.createModel(code, "typescript", uri);
  try {
    const getWorker = await m.languages.typescript.getTypeScriptWorker();
    const client = await getWorker(uri);
    const result = await client.getEmitOutput(uri.toString());
    const jsFile = result.outputFiles.find((f) => f.name.endsWith(".js"));
    let js = jsFile?.text ?? code;
    js = js.replace(/^import\b[^\n]*\n/gm, "");
    js = js.replace(/^"use strict";\n?/gm, "");
    js = js.replace(/\bexport\s+default\s+/g, "");
    const match = js.match(/^async\s+function\s+(\w+)\s*\(\s*ctx\b/m);
    if (match)
      js += `
await ${match[1]}(ctx);
`;
    return js;
  } finally {
    tsModel.dispose();
  }
}

class StepModeController {
  isStepModeActive = false;
  cases = [];
  currentCaseIdx = 0;
  currentStepInCase = 0;
  executedTransfers = [];
  revealedTransfers = [];
  batchIdx = 0;
  totalTransfers = 0;
  completedTransfers = 0;
  pendingReveals = [];
  batchErrors = new Map;
  isActive() {
    return this.isStepModeActive;
  }
  start(cases) {
    this.isStepModeActive = true;
    this.cases = cases;
    this.currentCaseIdx = 0;
    this.currentStepInCase = 0;
    this.executedTransfers = [];
    this.revealedTransfers = [];
    this.pendingReveals = [];
    this.batchErrors.clear();
    this.batchIdx = 0;
    this.totalTransfers = cases.reduce((sum, c) => sum + c.transfers.length, 0);
    this.completedTransfers = 0;
    if (cases.length > 0 && cases[0]) {
      switchToTab(cases[0].tabId);
      this.setupCase(cases[0]);
    }
    this.updateUI();
    this.showControls();
  }
  setupCase(caseData) {
    tb.reset();
    resetAccountRegistry();
    for (const meta of caseData.accountMeta) {
      registerAccountMeta(meta.id, meta.name, meta.type);
    }
    if (caseData.accounts.length > 0) {
      tb.createAccounts(caseData.accounts);
    }
    this.executedTransfers = [];
    this.revealedTransfers = [];
    this.pendingReveals = [];
    this.batchErrors.clear();
    this.batchIdx = 0;
  }
  async nextStep() {
    if (this.pendingReveals.length > 0) {
      const transfer2 = this.pendingReveals.shift();
      await this.revealTransfer(transfer2, this.batchErrors.get(transfer2.id.toString()));
      this.completedTransfers++;
      this.updateUI();
      return this.hasMoreSteps() || this.pendingReveals.length > 0;
    }
    const currentCase = this.cases[this.currentCaseIdx];
    if (!currentCase)
      return false;
    if (this.currentStepInCase >= currentCase.transfers.length) {
      this.currentCaseIdx++;
      this.currentStepInCase = 0;
      const nextCase = this.cases[this.currentCaseIdx];
      if (!nextCase)
        return false;
      switchToTab(nextCase.tabId);
      this.setupCase(nextCase);
    }
    const caseData = this.cases[this.currentCaseIdx];
    if (!caseData)
      return false;
    const batch = [];
    let idx = this.currentStepInCase;
    while (idx < caseData.transfers.length) {
      const t = caseData.transfers[idx];
      if (!t)
        break;
      batch.push(t);
      idx++;
      if ((t.flags & TransferFlags.linked) === 0)
        break;
    }
    this.currentStepInCase = idx;
    if (batch.length > 0) {
      const errors = tb.createTransfers(batch);
      const errByIdx = new Map(errors.map((e) => [e.index, e.result]));
      const successfulBalancingIds = batch.filter((_, i) => !errByIdx.has(i)).filter((t) => {
        const flags = t._meta.flags.toLowerCase();
        return flags.includes("balancing_debit") || flags.includes("balancing_credit");
      }).map((t) => t.id);
      const actualAmounts = new Map;
      if (successfulBalancingIds.length > 0) {
        const lookedUp = tb.lookupTransfers(successfulBalancingIds);
        for (const lt of lookedUp) {
          actualAmounts.set(lt.id, lt.amount);
        }
      }
      this.batchErrors.clear();
      for (let i = 0;i < batch.length; i++) {
        const t = batch[i];
        if (!t)
          continue;
        const err = errByIdx.get(i);
        const actualAmt = actualAmounts.get(t.id);
        const displayT = actualAmt !== undefined ? { ...t, amount: actualAmt } : t;
        if (err) {
          this.batchErrors.set(t.id.toString(), err);
        } else {
          this.executedTransfers.push({ ...displayT, batchIndex: this.batchIdx });
        }
      }
      this.batchIdx++;
      if (batch.length > 1) {
        this.pendingReveals = batch.slice(1).map((t) => {
          const actualAmt = actualAmounts.get(t.id);
          const displayT = actualAmt !== undefined ? { ...t, amount: actualAmt } : t;
          return { ...displayT, batchIndex: this.batchIdx - 1 };
        });
      }
      const firstTransfer = batch[0];
      if (firstTransfer) {
        const actualAmt = actualAmounts.get(firstTransfer.id);
        const displayT = actualAmt !== undefined ? { ...firstTransfer, amount: actualAmt } : firstTransfer;
        await this.revealTransfer({ ...displayT, batchIndex: this.batchIdx - 1 }, this.batchErrors.get(firstTransfer.id.toString()));
      }
    }
    this.completedTransfers++;
    this.updateUI();
    return this.hasMoreSteps() || this.pendingReveals.length > 0;
  }
  hasMoreSteps() {
    if (this.pendingReveals.length > 0)
      return true;
    if (this.currentCaseIdx >= this.cases.length)
      return false;
    const currentCase = this.cases[this.currentCaseIdx];
    if (!currentCase)
      return false;
    if (this.currentStepInCase < currentCase.transfers.length)
      return true;
    return this.currentCaseIdx < this.cases.length - 1;
  }
  async revealTransfer(t, error) {
    const tid = t.id.toString();
    for (const el of Array.from(logEl.querySelectorAll(".current-step"))) {
      el.classList.remove("current-step");
    }
    const logLine = logEl.querySelector(`[data-tid="${CSS.escape(tid)}"]`);
    logLine?.classList.add("current-step");
    const matches = monacoEditor.getModel()?.findMatches(`transfer\\(${tid}n`, true, true, false, null, false, 1) ?? [];
    if (matches.length > 0) {
      const line = matches[0].range.startLineNumber;
      transferLineDec.set([{
        range: new m.Range(line, 1, line, 1),
        options: { isWholeLine: true, className: "tb-transfer-line-highlight" }
      }]);
      monacoEditor.revealLineInCenter(line);
    }
    if (!error) {
      this.revealedTransfers.push(t);
      if (logLine) {
        logLine.innerHTML = logLine.innerHTML.replace("○", "✓").replace(" (queued)", "");
        logLine.classList.remove("log-info");
        logLine.classList.add("log-success");
      }
    } else {
      if (logLine) {
        logLine.innerHTML = logLine.innerHTML.replace("○", "✗").replace(" (queued)", `: ${error}`);
        logLine.classList.remove("log-info");
        logLine.classList.add("log-error");
      }
    }
    renderTAccounts(this.revealedTransfers, new Set([tid]));
    const panel = getActivePanel();
    const entries = panel ? Array.from(panel.querySelectorAll(`[data-tid="${CSS.escape(tid)}"]`)) : [];
    for (const entry of entries) {
      entry.classList.add("t-entry-new");
      entry.addEventListener("animationend", () => entry.classList.remove("t-entry-new"), { once: true });
    }
  }
  async runAll() {
    while (await this.nextStep()) {
      await new Promise((r) => setTimeout(r, 50));
    }
    this.exit();
  }
  exit() {
    this.isStepModeActive = false;
    this.pendingReveals = [];
    this.batchErrors.clear();
    this.hideControls();
    runBtn.disabled = false;
    monacoEditor.updateOptions({ readOnly: false });
    transferLineDec.clear();
    for (const el of Array.from(logEl.querySelectorAll(".current-step"))) {
      el.classList.remove("current-step");
    }
  }
  async executeBatch(batch) {
    const errors = tb.createTransfers(batch);
    const errByIdx = new Map(errors.map((e) => [e.index, e.result]));
    for (let i = 0;i < batch.length; i++) {
      const t = batch[i];
      if (!t)
        continue;
      const tid = t.id.toString();
      const err = errByIdx.get(i);
      for (const el of Array.from(logEl.querySelectorAll(".current-step"))) {
        el.classList.remove("current-step");
      }
      const logLine = logEl.querySelector(`[data-tid="${CSS.escape(tid)}"]`);
      logLine?.classList.add("current-step");
      const matches = monacoEditor.getModel()?.findMatches(`transfer\\(${tid}n`, true, true, false, null, false, 1) ?? [];
      if (matches.length > 0) {
        const line = matches[0].range.startLineNumber;
        transferLineDec.set([{
          range: new m.Range(line, 1, line, 1),
          options: { isWholeLine: true, className: "tb-transfer-line-highlight" }
        }]);
        monacoEditor.revealLineInCenter(line);
      }
      if (!err) {
        this.executedTransfers.push({ ...t, batchIndex: this.batchIdx });
        if (logLine) {
          logLine.innerHTML = logLine.innerHTML.replace("○", "✓").replace(" (queued)", "");
          logLine.classList.remove("log-info");
          logLine.classList.add("log-success");
        }
      } else {
        if (logLine) {
          logLine.innerHTML = logLine.innerHTML.replace("○", "✗").replace(" (queued)", `: ${err}`);
          logLine.classList.remove("log-info");
          logLine.classList.add("log-error");
        }
      }
      if (i < batch.length - 1) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    this.batchIdx++;
    renderTAccounts(this.executedTransfers);
    const panel = getActivePanel();
    for (const t of batch) {
      const tid = t.id.toString();
      const entries = panel ? Array.from(panel.querySelectorAll(`[data-tid="${CSS.escape(tid)}"]`)) : [];
      for (const entry of entries) {
        entry.classList.add("t-entry-new");
        entry.addEventListener("animationend", () => entry.classList.remove("t-entry-new"), { once: true });
      }
    }
  }
  async executeTransfer(t) {
    const errors = tb.createTransfers([t]);
    const tid = t.id.toString();
    for (const el of Array.from(logEl.querySelectorAll(".current-step"))) {
      el.classList.remove("current-step");
    }
    const logLine = logEl.querySelector(`[data-tid="${CSS.escape(tid)}"]`);
    logLine?.classList.add("current-step");
    const matches = monacoEditor.getModel()?.findMatches(`transfer\\(${tid}n`, true, true, false, null, false, 1) ?? [];
    if (matches.length > 0) {
      const line = matches[0].range.startLineNumber;
      transferLineDec.set([{
        range: new m.Range(line, 1, line, 1),
        options: { isWholeLine: true, className: "tb-transfer-line-highlight" }
      }]);
      monacoEditor.revealLineInCenter(line);
    }
    if (errors.length === 0) {
      this.executedTransfers.push({ ...t, batchIndex: this.batchIdx++ });
      if (logLine) {
        logLine.innerHTML = logLine.innerHTML.replace("○", "✓").replace(" (queued)", "");
        logLine.classList.remove("log-info");
        logLine.classList.add("log-success");
      }
    } else {
      if (logLine) {
        const errMsg = errors[0]?.result ?? "error";
        logLine.innerHTML = logLine.innerHTML.replace("○", "✗").replace(" (queued)", `: ${errMsg}`);
        logLine.classList.remove("log-info");
        logLine.classList.add("log-error");
      }
    }
    renderTAccounts(this.executedTransfers);
    const panel = getActivePanel();
    const entries = panel ? Array.from(panel.querySelectorAll(`[data-tid="${CSS.escape(tid)}"]`)) : [];
    for (const entry of entries) {
      entry.classList.add("t-entry-new");
      entry.addEventListener("animationend", () => entry.classList.remove("t-entry-new"), { once: true });
    }
  }
  updateUI() {
    stepCurrentEl.textContent = String(Math.min(this.completedTransfers + 1, this.totalTransfers));
    stepTotalEl.textContent = String(this.totalTransfers);
  }
  showControls() {
    stepControlsEl.classList.remove("hidden");
    runDropdown.style.display = "none";
    monacoEditor.updateOptions({ readOnly: true });
  }
  hideControls() {
    stepControlsEl.classList.add("hidden");
    runDropdown.style.display = "";
  }
}
var stepMode = new StepModeController;
async function runCode(useStepMode = false) {
  runBtn.disabled = true;
  logEl.innerHTML = "";
  setStatus(useStepMode ? "Collecting transfers…" : "Running…", "running");
  for (const tab of [...tAccountsTabs]) {
    tab.tabEl.remove();
    tab.panelEl.remove();
  }
  tAccountsTabs.length = 0;
  activeTabId = null;
  tabCounter = 0;
  const collectedCases = [];
  let currentCaseTransfers = [];
  let currentCaseAccounts = [];
  let currentCaseAccountMeta = [];
  let currentCaseTabId = null;
  let currentCaseNameForStep = null;
  try {
    const rawCode = monacoEditor.getValue();
    const code = await preprocessCode(rawCode);
    tb.reset();
    resetAccountRegistry();
    let batchIndex = 0;
    let allTransfers = [];
    const resetAccountRegistryWithTab = (startId, caseName) => {
      if (useStepMode && currentCaseTabId !== null && (currentCaseTransfers.length > 0 || currentCaseAccounts.length > 0)) {
        collectedCases.push({
          caseName: currentCaseNameForStep ?? "case",
          tabId: currentCaseTabId,
          accounts: [...currentCaseAccounts],
          accountMeta: [...currentCaseAccountMeta],
          transfers: [...currentCaseTransfers]
        });
        currentCaseTransfers = [];
        currentCaseAccounts = [];
        currentCaseAccountMeta = [];
      }
      const tabName = caseName ?? `run ${tabCounter + 1}`;
      currentCaseName = tabName;
      currentCaseNameForStep = tabName;
      const tab = createTab(tabName);
      currentCaseTabId = tab.id;
      resetAccountRegistry(startId);
      tb.reset();
      allTransfers = [];
    };
    const createAccounts = async (accounts) => {
      const errors = tb.createAccounts(accounts);
      if (errors.length === 0) {
        log(`✓ Created ${accounts.length} account${accounts.length === 1 ? "" : "s"}`, "success");
        if (useStepMode) {
          currentCaseAccounts.push(...accounts);
          const idToName2 = getIdToName();
          const idToType2 = getIdToType();
          for (const acc of accounts) {
            const name = idToName2.get(acc.id);
            const type = idToType2.get(acc.id);
            if (name && type) {
              currentCaseAccountMeta.push({ id: acc.id, name, type });
            }
          }
        }
      } else {
        for (const e of errors) {
          log(`⚠ Account ${String(accounts[e.index]?.id)}: ${e.result}`, "warn");
        }
      }
      renderTAccounts(allTransfers);
      return errors;
    };
    const createTransfers = async (transfers) => {
      if (useStepMode) {
        for (const t of transfers) {
          currentCaseTransfers.push(t);
          const tid = t.id.toString();
          logTransfer(`○ ${fmtTransfer(t)} (queued)`, "info", tid);
        }
        return [];
      }
      const errors = tb.createTransfers(transfers);
      const bi = batchIndex++;
      const errByIdx = new Map(errors.map((e) => [e.index, e.result]));
      let rootCauseIdx = -1;
      let rootCauseErr = "";
      for (const e of errors) {
        if (e.result !== "linked_event_chain_open" && e.result !== "linked_event_failed") {
          rootCauseIdx = e.index;
          rootCauseErr = e.result;
          break;
        }
      }
      const successfulIds = transfers.filter((_, i) => !errByIdx.has(i)).filter((t) => {
        const flags = t._meta.flags.toLowerCase();
        return flags.includes("balancing_debit") || flags.includes("balancing_credit");
      }).map((t) => t.id);
      const actualAmounts = new Map;
      if (successfulIds.length > 0) {
        const lookedUp = tb.lookupTransfers(successfulIds);
        for (const lt of lookedUp) {
          actualAmounts.set(lt.id, lt.amount);
        }
      }
      for (let i = 0;i < transfers.length; i++) {
        const t = transfers[i];
        if (!t)
          continue;
        let err = errByIdx.get(i);
        const failsWith = t._meta?.failsWith;
        if (err === "linked_event_chain_open" && i !== rootCauseIdx) {
          err = "linked_event_failed";
        }
        const tid = t.id.toString();
        const actualAmt = actualAmounts.get(t.id);
        const displayT = actualAmt !== undefined ? { ...t, amount: actualAmt } : t;
        if (err) {
          if (failsWith && (err === failsWith || i === rootCauseIdx && rootCauseErr === failsWith)) {
            logTransfer(`✓ ${fmtTransfer(displayT)} (failed as expected: ${rootCauseIdx === i ? rootCauseErr : err})`, "success", tid);
          } else if (err === "linked_event_failed") {
            logTransfer(`  ↳ ${String(t.id).padStart(6)}  ${fmtAmtPad(t.amount)}  Dr. ${t._meta.dr.padEnd(20)}  Cr. ${t._meta.cr.padEnd(20)}${fmtFlags(t._meta.flags)}: linked_event_failed`, "info", tid);
          } else if (i === rootCauseIdx) {
            logTransfer(`✗ ${String(t.id).padStart(6)}  ${fmtAmtPad(t.amount)}  Dr. ${t._meta.dr.padEnd(20)}  Cr. ${t._meta.cr.padEnd(20)}${fmtFlags(t._meta.flags)}: ${rootCauseErr}`, "error", tid);
          } else {
            logTransfer(`✗ ${String(t.id).padStart(6)}  ${fmtAmtPad(t.amount)}  Dr. ${t._meta.dr.padEnd(20)}  Cr. ${t._meta.cr.padEnd(20)}${fmtFlags(t._meta.flags)}: ${err}`, "error", tid);
          }
        } else {
          if (failsWith) {
            logTransfer(`✗ ${String(t.id).padStart(6)}  ${fmtAmtPad(t.amount)}  Dr. ${t._meta.dr.padEnd(20)}  Cr. ${t._meta.cr.padEnd(20)}${fmtFlags(t._meta.flags)}: expected ${failsWith} but succeeded`, "error", tid);
          } else {
            allTransfers.push(Object.assign({}, displayT, { batchIndex: bi }));
            if (actualAmt !== undefined && actualAmt !== t.amount) {
              logTransfer(`✓ ${fmtTransfer(displayT)} (requested: ${fmtAmt(t.amount)})`, "success", tid);
            } else {
              logTransfer(`✓ ${fmtTransfer(displayT)}`, "success", tid);
            }
          }
        }
      }
      renderTAccounts(allTransfers);
      return errors;
    };
    const tbShim = { createAccounts, createTransfers };
    const ctx = { tb: tbShim, caseFilter: undefined };
    const logShim = {
      text: (msg) => log(msg, "info"),
      bold: (msg) => log(msg, "info"),
      dim: (msg) => log(msg, "info"),
      success: (msg) => log(msg, "success"),
      error: (msg) => log(msg, "error"),
      warn: (msg) => log(msg, "warn"),
      section: (title, desc) => log(desc ? `${title}: ${desc}` : title, "info"),
      batch: (num, ...lines) => {
        log(`─── Batch #${num} ${"─".repeat(45)}`, "info");
        for (const l of lines)
          log(`  ${l}`, "info");
      }
    };
    const formatArg = (arg) => {
      if (arg === null)
        return "null";
      if (arg === undefined)
        return "undefined";
      if (typeof arg === "string")
        return arg;
      if (typeof arg === "bigint")
        return `${arg}n`;
      if (typeof arg === "object") {
        try {
          return JSON.stringify(arg, (_, v) => typeof v === "bigint" ? `${v}n` : v, 2);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    };
    const consoleShim = {
      log: (...args) => log(args.map(formatArg).join(" "), "info"),
      info: (...args) => log(args.map(formatArg).join(" "), "info"),
      warn: (...args) => log(args.map(formatArg).join(" "), "warn"),
      error: (...args) => log(args.map(formatArg).join(" "), "error"),
      debug: (...args) => log(args.map(formatArg).join(" "), "info")
    };

    class CaseContext {
      constructor() {}
      async createAccounts(accounts) {
        await createAccounts(accounts);
      }
      async batch(batchNum, desc, transfers) {
        const descLines = Array.isArray(desc) ? desc : desc ? [desc] : [];
        log(`─── Batch #${batchNum} ${"─".repeat(45)}`, "info");
        for (const l of descLines)
          log(`  ${l}`, "info");
        for (let i = 0;i < transfers.length - 1; i++) {
          const t = transfers[i];
          if (t && !(t.flags & TransferFlags.linked)) {
            t.flags = t.flags | TransferFlags.linked;
            if (t._meta.flags) {
              t._meta.flags = `linked | ${t._meta.flags}`;
            } else {
              t._meta.flags = "linked";
            }
          }
        }
        await createTransfers(transfers);
      }
    }
    const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
    await new AsyncFunction("account", "transfer", "createAccounts", "createTransfers", "resetAccountRegistry", "setLedgerName", "defineLedger", "AccountFlags", "TransferFlags", "AccountFilterFlags", "QueryFilterFlags", "amount_max", "getAccountId", "ctx", "log", "CaseContext", "tb", "console", code)(account, transfer, createAccounts, createTransfers, resetAccountRegistryWithTab, setLedgerName, defineLedger, AccountFlags, TransferFlags, AccountFilterFlags, QueryFilterFlags, amount_max, getAccountId, ctx, logShim, CaseContext, tb, consoleShim);
    if (useStepMode) {
      if (currentCaseTabId !== null && (currentCaseTransfers.length > 0 || currentCaseAccounts.length > 0)) {
        collectedCases.push({
          caseName: currentCaseNameForStep ?? "case",
          tabId: currentCaseTabId,
          accounts: [...currentCaseAccounts],
          accountMeta: [...currentCaseAccountMeta],
          transfers: [...currentCaseTransfers]
        });
      }
      const totalTransfers = collectedCases.reduce((sum, c) => sum + c.transfers.length, 0);
      if (totalTransfers > 0) {
        stepMode.start(collectedCases);
        setStatus(`Step Mode: ${totalTransfers} transfers`, "running");
        return;
      } else {
        setStatus("No transfers to step through", "ok");
      }
    } else {
      setStatus("Done", "ok");
    }
  } catch (err) {
    setStatus("Error", "error");
    log(String(err), "error");
    console.error(err);
    if (useStepMode) {
      stepMode.exit();
    }
  } finally {
    if (!useStepMode || !stepMode.isActive()) {
      runBtn.disabled = false;
    }
  }
}
function setStatus(text, state) {
  statusEl.textContent = text;
  statusEl.className = `status status-${state}`;
}
function log(text, type = "info") {
  const line = document.createElement("div");
  line.className = `log-line log-${type}`;
  line.textContent = text;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}
function logTransfer(text, type, tid) {
  const line = document.createElement("div");
  line.className = `log-line log-${type}`;
  line.textContent = text;
  line.dataset.tid = tid;
  line.addEventListener("mouseenter", () => highlightTransfer(tid, true));
  line.addEventListener("mouseleave", () => highlightTransfer(tid, false));
  line.addEventListener("click", () => goToTransferLine(tid));
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}
function goToTransferLine(tid) {
  const matches = monacoEditor.getModel()?.findMatches(`transfer\\(${tid}n`, true, true, false, null, false, 1) ?? [];
  if (matches.length > 0) {
    const lineNum = matches[0].range.startLineNumber;
    monacoEditor.revealLineInCenter(lineNum);
    monacoEditor.setPosition({ lineNumber: lineNum, column: 1 });
    monacoEditor.focus();
  }
}
function esc2(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fmtAmt(n, ledger) {
  const scale = ledger !== undefined ? getLedgerAssetScale(ledger) : 0;
  if (scale === 0) {
    return n.toLocaleString();
  }
  const divisor = 10n ** BigInt(scale);
  const intPart = n / divisor;
  const fracPart = n % divisor;
  const fracStr = fracPart.toString().padStart(scale, "0");
  return `${intPart.toLocaleString()}.${fracStr}`;
}
function fmtAmtPad(n, ledger, width = 12) {
  return fmtAmt(n, ledger).padStart(width);
}
function fmtFlags(flagsStr) {
  if (!flagsStr)
    return "";
  const parts = flagsStr.split("|").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0)
    return "";
  return ` [${parts.join(" | ")}]`;
}
function fmtTransfer(t) {
  return `${String(t.id).padStart(6)}  ${fmtAmtPad(t.amount)}  Dr. ${t._meta.dr.padEnd(20)}  Cr. ${t._meta.cr.padEnd(20)}${fmtFlags(t._meta.flags)}`;
}
function isDebitNormalAccount(acc) {
  const accountType = getAccountType(acc);
  return accountType === "Asset" || accountType === "Expense";
}
function getAccountType(acc) {
  const types = getIdToType();
  return types.get(acc.id) ?? "Asset";
}
function renderTAccountCard(acc, name, allTransfers, voidedIds, newTransferIds) {
  const accountType = getAccountType(acc);
  const isDebitNormal = isDebitNormalAccount(acc);
  const isVoidTransfer = (t) => (t.flags & TransferFlags.void_pending_transfer) !== 0;
  const debits = allTransfers.filter((t) => t.debit_account_id === acc.id && !isVoidTransfer(t));
  const credits = allTransfers.filter((t) => t.credit_account_id === acc.id && !isVoidTransfer(t));
  let debitRows = "";
  for (const t of debits) {
    const isPending = (t.flags & TransferFlags.pending) !== 0;
    const isVoided = voidedIds.has(t.id.toString());
    const voidedClass = isVoided ? " voided" : "";
    const animDelay = t.batchIndex * 0.15;
    debitRows += `<div class="t-entry debit-entry t-entry-new${voidedClass}" data-tid="${esc2(t.id.toString())}" style="animation-delay: ${animDelay}s">
      <span class="entry-pending">${isPending ? "(p)" : ""}</span><span class="entry-amount">${esc2(fmtAmt(t.amount, acc.ledger))}</span>
    </div>`;
  }
  let creditRows = "";
  for (const t of credits) {
    const isPending = (t.flags & TransferFlags.pending) !== 0;
    const isVoided = voidedIds.has(t.id.toString());
    const voidedClass = isVoided ? " voided" : "";
    const animDelay = t.batchIndex * 0.15;
    creditRows += `<div class="t-entry credit-entry t-entry-new${voidedClass}" data-tid="${esc2(t.id.toString())}" style="animation-delay: ${animDelay}s">
      <span class="entry-pending">${isPending ? "(p)" : ""}</span><span class="entry-amount">${esc2(fmtAmt(t.amount, acc.ledger))}</span>
    </div>`;
  }
  let drTotal = 0n;
  let crTotal = 0n;
  for (const t of debits) {
    const isVoided = voidedIds.has(t.id.toString());
    if (!isVoided) {
      drTotal += t.amount;
    }
  }
  for (const t of credits) {
    const isVoided = voidedIds.has(t.id.toString());
    if (!isVoided) {
      crTotal += t.amount;
    }
  }
  let netDrValue = 0n;
  let netCrValue = 0n;
  if (drTotal > crTotal) {
    netDrValue = drTotal - crTotal;
  } else if (crTotal > drTotal) {
    netCrValue = crTotal - drTotal;
  } else {}
  const showDrTotal = netDrValue > 0n || netDrValue === 0n && netCrValue === 0n && isDebitNormal;
  const showCrTotal = netCrValue > 0n || netCrValue === 0n && netDrValue === 0n && !isDebitNormal;
  const accountMaxBatchIndex = Math.max(0, ...debits.map((t) => t.batchIndex), ...credits.map((t) => t.batchIndex));
  const hasNewEntries = [...debits, ...credits].some((t) => newTransferIds.has(t.id.toString()));
  const ledgerNames = getLedgerIdToName();
  const ledgerName = ledgerNames.get(acc.ledger) ?? `L${acc.ledger}`;
  const ledgerColorClass = `ledger-color-${acc.ledger % 6}`;
  const card = document.createElement("div");
  card.className = "t-account";
  card.dataset.accountId = acc.id.toString();
  card.innerHTML = `
    <div class="t-account-header">
      <div class="t-account-header-left">
        <span class="t-account-type">${esc2(accountType)}</span>
        <span class="t-account-name">${esc2(name)}</span>
      </div>
      <span class="t-account-ledger ${ledgerColorClass}">${esc2(ledgerName)}</span>
    </div>
    <div class="t-account-body">
      <div class="t-side t-debit">
        <div class="t-entries">${debitRows}</div>
      </div>
      <div class="t-divider"></div>
      <div class="t-side t-credit">
        <div class="t-entries">${creditRows}</div>
      </div>
    </div>
    <div class="t-totals-row${hasNewEntries ? " t-totals-new" : ""}"${hasNewEntries ? ` style="animation-delay: ${(accountMaxBatchIndex + 1) * 0.15}s"` : ""}>
      <div class="t-total t-total-debit">
        ${showDrTotal ? `<span class="t-total-symbol">=</span>` : ""}<span class="t-total-amount">${showDrTotal ? esc2(fmtAmt(netDrValue, acc.ledger)) : ""}</span>
      </div>
      <div class="t-total-divider"></div>
      <div class="t-total t-total-credit">
        ${showCrTotal ? `<span class="t-total-symbol">=</span>` : ""}<span class="t-total-amount">${showCrTotal ? esc2(fmtAmt(netCrValue, acc.ledger)) : ""}</span>
      </div>
    </div>
  `;
  return card;
}
function renderTAccounts(allTransfers, newTransferIds) {
  const panel = getActivePanel();
  if (!panel)
    return;
  const accounts = tb.getAllAccounts();
  const names = getIdToName();
  const ledgerNames = getLedgerIdToName();
  const activeTab = tAccountsTabs.find((t) => t.id === activeTabId);
  if (activeTab) {
    activeTab.accountSnapshots.clear();
    for (const acc of accounts) {
      activeTab.accountSnapshots.set(acc.id, acc);
    }
  }
  const voidedIds = new Set;
  for (const t of allTransfers) {
    const isVoid = (t.flags & TransferFlags.void_pending_transfer) !== 0;
    const isPost = (t.flags & TransferFlags.post_pending_transfer) !== 0;
    if ((isVoid || isPost) && t.pending_id !== 0n) {
      voidedIds.add(t.pending_id.toString());
    }
  }
  const effectiveNewIds = newTransferIds ?? new Set(allTransfers.map((t) => t.id.toString()));
  let maxNumLen = 0;
  for (const t of allTransfers) {
    const len = fmtAmt(t.amount, t.ledger).length;
    if (len > maxNumLen)
      maxNumLen = len;
  }
  for (const acc of accounts) {
    const drTotal = acc.debits_posted + acc.debits_pending;
    const crTotal = acc.credits_posted + acc.credits_pending;
    const balance = drTotal > crTotal ? drTotal - crTotal : crTotal - drTotal;
    const len = fmtAmt(balance, acc.ledger).length;
    if (len > maxNumLen)
      maxNumLen = len;
  }
  const debitNormalByLedger = new Map;
  const creditNormalByLedger = new Map;
  for (const acc of accounts) {
    const targetMap = isDebitNormalAccount(acc) ? debitNormalByLedger : creditNormalByLedger;
    if (!targetMap.has(acc.ledger)) {
      targetMap.set(acc.ledger, []);
    }
    targetMap.get(acc.ledger).push(acc);
  }
  panel.innerHTML = "";
  panel.classList.remove("t-scale-sm", "t-scale-xs", "t-scale-xxs");
  if (maxNumLen > 12) {
    panel.classList.add("t-scale-xxs");
  } else if (maxNumLen > 10) {
    panel.classList.add("t-scale-xs");
  } else if (maxNumLen > 8) {
    panel.classList.add("t-scale-sm");
  }
  function renderTypeSection(title, className, ledgerMap) {
    if (ledgerMap.size === 0)
      return;
    const section = document.createElement("div");
    section.className = `t-accounts-section ${className}`;
    const header = document.createElement("div");
    header.className = "t-accounts-section-header";
    header.textContent = title;
    section.appendChild(header);
    for (const [ledgerId, accs] of ledgerMap) {
      const ledgerName = ledgerNames.get(ledgerId) ?? `Ledger ${ledgerId}`;
      const cardsRow = document.createElement("div");
      cardsRow.className = "t-accounts-row";
      for (const acc of accs) {
        const name = names.get(acc.id) ?? acc.id.toString();
        cardsRow.appendChild(renderTAccountCard(acc, name, allTransfers, voidedIds, effectiveNewIds));
      }
      section.appendChild(cardsRow);
    }
    panel.appendChild(section);
  }
  renderTypeSection("Assets & Expenses", "debit-normal", debitNormalByLedger);
  renderTypeSection("Liabilities, Equity & Income", "credit-normal", creditNormalByLedger);
  for (const entry of Array.from(panel.querySelectorAll(".t-entry[data-tid]"))) {
    entry.addEventListener("mouseenter", () => highlightTransfer(entry.dataset.tid, true));
    entry.addEventListener("mouseleave", () => highlightTransfer(entry.dataset.tid, false));
  }
  for (const card of Array.from(panel.querySelectorAll(".t-account[data-account-id]"))) {
    card.addEventListener("mouseenter", () => handleCardMouseEnter(card));
    card.addEventListener("mouseleave", () => handleCardMouseLeave());
  }
}
function highlightTransfer(tid, on) {
  const panel = getActivePanel();
  if (panel) {
    for (const el of Array.from(panel.querySelectorAll(`[data-tid="${CSS.escape(tid)}"]`))) {
      el.classList.toggle("t-entry-highlight", on);
    }
  }
  for (const el of Array.from(logEl.querySelectorAll(`[data-tid="${CSS.escape(tid)}"]`))) {
    el.classList.toggle("log-line-highlight", on);
  }
  if (on) {
    const matches = monacoEditor.getModel()?.findMatches(`transfer\\(${tid}n`, true, true, false, null, false, 1) ?? [];
    if (matches.length > 0) {
      const line = matches[0].range.startLineNumber;
      transferLineDec.set([{
        range: new m.Range(line, 1, line, 1),
        options: { isWholeLine: true, className: "tb-transfer-line-highlight" }
      }]);
    }
  } else {
    transferLineDec.clear();
  }
}
var popoverTimeout = null;
var currentHoveredCard = null;
function showAccountPopover(card) {
  const accountIdStr = card.dataset.accountId;
  if (!accountIdStr)
    return;
  const accountId = BigInt(accountIdStr);
  const panel = card.closest(".t-accounts-panel");
  const tab = tAccountsTabs.find((t) => t.panelEl === panel);
  if (!tab)
    return;
  const account2 = tab.accountSnapshots.get(accountId);
  if (!account2)
    return;
  const json = serializeAccountToJson(account2);
  accountJsonContent.innerHTML = formatJsonWithHighlighting(json);
  const rect = card.getBoundingClientRect();
  let top = rect.bottom + 8;
  let left = rect.left;
  if (top + 300 > window.innerHeight)
    top = rect.top - 300 - 8;
  if (left + 400 > window.innerWidth)
    left = window.innerWidth - 420;
  if (left < 20)
    left = 20;
  accountJsonPopover.style.top = `${top}px`;
  accountJsonPopover.style.left = `${left}px`;
  accountJsonPopover.classList.add("visible");
}
function hideAccountPopover() {
  if (popoverTimeout)
    clearTimeout(popoverTimeout);
  popoverTimeout = null;
  accountJsonPopover.classList.remove("visible");
  currentHoveredCard = null;
}
function handleCardMouseEnter(card) {
  if (popoverTimeout)
    clearTimeout(popoverTimeout);
  currentHoveredCard = card;
  popoverTimeout = setTimeout(() => {
    if (currentHoveredCard === card)
      showAccountPopover(card);
  }, 150);
}
function handleCardMouseLeave() {
  if (popoverTimeout)
    clearTimeout(popoverTimeout);
  popoverTimeout = setTimeout(hideAccountPopover, 50);
}
