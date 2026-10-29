(function () {
  const T = window.TekmetricText;
  const api = window.tekmetric;
  const VIEWS = {
    dashboard: ['Today', 'Dashboard'],
    calendar: ['Shop calendar', 'Calendar'],
    repairs: ['Shop floor', 'Repair orders'],
    diagnostics: ['On this computer', 'Diagnostics'],
    settings: ['This computer', 'Settings'],
  };
  const STATUS_LABEL = {
    estimate: 'Estimate',
    'in-progress': 'In progress',
    'waiting-parts': 'Waiting on parts',
    ready: 'Ready',
    closed: 'Closed',
  };

  const ui = {
    view: 'dashboard',
    selectedId: null,
    weekOffset: 0,
    dirty: false,
    diag: null,
    diagForm: { vehicle: '2018 Honda CR-V', symptoms: '', notes: '' },
  };
  let data = null;
  let toastTimer = 0;
  let closeModal = function () {};

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    const props = attrs || {};
    Object.keys(props).forEach(function (key) {
      const value = props[key];
      if (value == null || value === false) return;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.indexOf('on') === 0 && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, String(value));
    });
    const list = children == null ? [] : [].concat(children);
    list.forEach(function (child) {
      if (child == null || child === false) return;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    });
    return node;
  }

  function field(label, control, wide) {
    return el('label', { class: wide ? 'field wide' : 'field' }, [el('span', { text: label }), control]);
  }

  function textInput(id, value, attrs) {
    const node = el('input', Object.assign({ id: id, type: 'text' }, attrs || {}));
    node.value = value == null ? '' : String(value);
    return node;
  }

  function area(id, value, attrs) {
    const node = el('textarea', Object.assign({
      id: id,
      spellcheck: 'true',
      lang: 'en-CA',
      'data-capitalize': 'true',
    }, attrs || {}));
    node.value = value == null ? '' : String(value);
    return node;
  }

  function chip(status) {
    return el('span', { class: 'chip chip-' + status, text: STATUS_LABEL[status] || status });
  }

  function moneyOf(qty, price) {
    const qtyH = T.qtyToHundredths(qty);
    const cents = T.dollarsToCents(price);
    if (qtyH == null || cents == null) return '';
    return T.formatMoney(T.lineTotalCents(qtyH, cents));
  }

  function toast(message, isError) {
    const node = document.getElementById('toast');
    node.hidden = false;
    node.textContent = message;
    node.classList.toggle('error', Boolean(isError));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.hidden = true; }, 4200);
  }

  function ask(config) {
    const modal = document.getElementById('modal');
    modal.hidden = false;
    const controls = (config.fields || []).map(function (item) {
      let control;
      if (item.type === 'textarea') control = area('f-' + item.name, item.value || '');
      else if (item.type === 'select') {
        control = el('select', { id: 'f-' + item.name });
        item.options.forEach(function (opt) {
          const option = el('option', { value: opt.value, text: opt.label });
          if (opt.value === item.value) option.selected = true;
          control.append(option);
        });
      } else if (item.type === 'checkbox') {
        control = el('input', { id: 'f-' + item.name, type: 'checkbox' });
        control.checked = Boolean(item.value);
      } else {
        control = textInput('f-' + item.name, item.value || '', { type: item.type || 'text', spellcheck: item.spell ? 'true' : 'false', 'data-capitalize': item.capitalize ? 'true' : 'false' });
      }
      return field(item.label, control, item.wide);
    });
    const confirm = el('button', { type: 'button', class: config.danger ? 'btn btn-danger' : 'btn btn-primary', text: config.confirmLabel || 'Save' });
    const cancel = el('button', { type: 'button', class: 'btn btn-ghost', text: 'Cancel' });
    const extra = config.extraLabel
      ? el('button', { type: 'button', class: 'btn btn-danger', text: config.extraLabel })
      : null;
    const card = el('div', { class: 'modal-card', role: 'dialog', 'aria-modal': 'true' });
    card.append(el('h2', { text: config.title }));
    if (config.body) card.append(el('p', { class: 'muted', text: config.body }));
    controls.forEach(function (node) { card.append(node); });
    const actions = el('div', { class: 'modal-actions' });
    if (extra) actions.append(extra);
    actions.append(el('span', { class: 'right' }), cancel, confirm);
    card.append(actions);
    modal.replaceChildren(card);
    const first = card.querySelector('input, textarea, select, button');
    if (first) first.focus();
    return new Promise(function (resolve) {
      function finish(value) {
        modal.hidden = true;
        modal.replaceChildren();
        closeModal = function () {};
        resolve(value);
      }
      closeModal = function () { finish(null); };
      cancel.addEventListener('click', function () { finish(null); });
      confirm.addEventListener('click', function () {
        if (!config.fields) { finish(true); return; }
        const values = {};
        config.fields.forEach(function (item) {
          const node = document.getElementById('f-' + item.name);
          if (item.type === 'checkbox') values[item.name] = node.checked;
          else values[item.name] = node.value;
        });
        finish(values);
      });
      if (extra) extra.addEventListener('click', function () { finish({ __extra: true }); });
    });
  }

  function applyDark(on) {
    document.body.classList.toggle('dark', Boolean(on));
    const button = document.getElementById('dark-toggle');
    if (button) button.textContent = on ? 'Light mode' : 'Dark mode';
  }

  function setNav() {
    document.querySelectorAll('.nav-btn').forEach(function (button) {
      if (button.getAttribute('data-view') === ui.view) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    const titles = VIEWS[ui.view] || VIEWS.dashboard;
    document.getElementById('eyebrow').textContent = titles[0];
    document.getElementById('title').textContent = titles[1];
    document.title = titles[1] + " — Tekmetric Pro";
    const pill = document.getElementById('shop-pill');
    if (data) pill.textContent = data.shopClock.openLabel;
  }

  function sortedAppointments(list) {
    return list.slice().sort(function (a, b) {
      return (a.date + a.time).localeCompare(b.date + b.time);
    });
  }

  function renderDashboard() {
    const today = data.shopClock.iso;
    const todays = sortedAppointments(data.appointments.filter(function (item) { return item.date === today; }));
    const openOrders = data.repairOrders.filter(function (order) { return order.status !== 'closed'; });
    const waiting = data.repairOrders.filter(function (order) { return order.status === 'waiting-parts'; }).length;
    const ready = data.repairOrders.filter(function (order) { return order.status === 'ready'; }).length;
    const hasSample = data.appointments.some(function (item) { return item.sample; }) || data.repairOrders.some(function (order) { return order.sample; });
    const root = el('div', { class: 'stack' });
    if (data.notice) {
      root.append(el('div', { class: 'notice' }, [
        el('span', { text: data.notice }),
        el('button', { type: 'button', class: 'btn btn-ghost', text: 'Dismiss', 'data-action': 'dismiss-notice' }),
      ]));
    }
    if (hasSample) {
      root.append(el('div', { class: 'banner' }, [
        el('span', { text: 'Starter jobs are on the board so the workflow is visible. Remove them when the real day begins.' }),
        el('button', { type: 'button', class: 'btn btn-ghost', text: 'Remove starter jobs', 'data-action': 'clear-samples' }),
      ]));
    }
    root.append(el('div', { class: 'stat-grid' }, [
      stat(String(openOrders.length), 'Open repair orders'),
      stat(String(todays.length), "Today's appointments"),
      stat(String(waiting), 'Waiting on parts'),
      stat(String(ready), 'Ready for pickup'),
    ]));
    const apptCard = el('section', { class: 'card' }, [
      el('div', { class: 'card-head' }, [
        el('h2', { text: 'Today' }),
        el('button', { type: 'button', class: 'btn btn-primary', text: 'Add appointment', 'data-action': 'add-appointment', 'data-date': today }),
      ]),
    ]);
    if (!todays.length) apptCard.append(el('p', { class: 'empty', text: 'Nothing booked today.' }));
    todays.forEach(function (item) { apptCard.append(appointmentRow(item, true)); });
    const roCard = el('section', { class: 'card' }, [
      el('div', { class: 'card-head' }, [el('h2', { text: 'Active repair orders' })]),
    ]);
    if (!openOrders.length) roCard.append(el('p', { class: 'empty', text: 'No open repair orders.' }));
    openOrders.forEach(function (order) {
      roCard.append(el('button', { type: 'button', class: 'row', 'data-action': 'open-ro', 'data-id': order.id }, [
        el('span', { class: 'ro-num', text: 'RO ' + order.number }),
        el('span', {}, [el('span', { class: 'who', text: order.customer }), el('div', { class: 'sub', text: order.vehicle })]),
        chip(order.status),
      ]));
    });
    root.append(el('div', { class: 'split' }, [apptCard, roCard]));
    return root;
  }

  function stat(value, label) {
    return el('section', { class: 'card stat' }, [
      el('div', { class: 'stat-value', text: value }),
      el('div', { class: 'stat-label', text: label }),
    ]);
  }

  function appointmentRow(item, inline) {
    return el('div', { class: (inline ? 'row' : 'appt') + (item.done ? ' is-done' : '') }, [
      item.done ? el('span', { class: 'done-x', text: 'X', 'aria-hidden': 'true' }) : null,
      el('span', { class: 'time', text: T.formatTime(item.time) }),
      el('span', {}, [
        el('span', { class: 'who', text: item.customer }),
        el('div', { class: 'sub', text: item.service + ' · ' + item.vehicle }),
      ]),
      el('button', {
        type: 'button',
        class: 'btn btn-ghost',
        text: item.done ? 'Reopen' : 'Mark done',
        'data-action': 'toggle-done',
        'data-id': item.id,
      }),
    ]);
  }

  function renderCalendar() {
    const today = data.shopClock.iso;
    const start = T.addDays(T.mondayOf(today), ui.weekOffset * 7);
    const days = [0, 1, 2, 3, 4, 5, 6].map(function (offset) { return T.addDays(start, offset); });
    const root = el('div', { class: 'stack' });
    root.append(el('div', { class: 'toolbar' }, [
      el('div', { class: 'muted', text: T.formatPretty(days[0]) + ' – ' + T.formatPretty(days[6]) }),
      el('div', {}, [
        el('button', { type: 'button', class: 'btn btn-ghost', text: 'This week', 'data-action': 'week-today' }),
        el('button', { type: 'button', class: 'btn btn-ghost', text: 'Previous', 'data-action': 'week-prev' }),
        el('button', { type: 'button', class: 'btn btn-ghost', text: 'Next', 'data-action': 'week-next' }),
      ]),
    ]));
    const week = el('div', { class: 'week' });
    days.forEach(function (iso) {
      const index = T.weekdayIndex(iso);
      const hours = T.weekdayHours(index);
      const col = el('section', { class: 'day-col' + (iso === today ? ' is-today' : '') });
      col.append(
        el('div', { class: 'card-head' }, [
          el('div', {}, [
            el('div', { class: 'day-name', text: T.formatWeekday(iso) }),
            el('div', { class: 'day-num', text: iso.slice(8) }),
          ]),
          el('button', { type: 'button', class: 'icon-btn', text: '+', 'aria-label': 'Add appointment', 'data-action': 'add-appointment', 'data-date': iso }),
        ])
      );
      if (!hours) col.append(el('div', { class: 'closed-tag', text: 'Closed' }));
      else col.append(el('div', { class: 'closed-tag', text: T.formatTime(hours.open) + ' – ' + T.formatTime(hours.close) }));
      sortedAppointments(data.appointments.filter(function (item) { return item.date === iso; })).forEach(function (item) {
        const card = el('article', { class: 'appt' + (item.done ? ' is-done' : '') });
        if (item.done) card.append(el('span', { class: 'done-x', text: 'X', 'aria-hidden': 'true' }));
        card.append(
          el('div', { class: 'time', text: T.formatTime(item.time) }),
          el('div', { class: 'who', text: item.customer }),
          el('div', { class: 'sub', text: item.service }),
          el('div', { class: 'sub', text: item.vehicle }),
          el('button', {
            type: 'button',
            class: 'btn btn-ghost',
            text: item.done ? 'Reopen' : 'Done',
            'data-action': 'toggle-done',
            'data-id': item.id,
          }),
          el('button', { type: 'button', class: 'btn btn-ghost', text: 'Edit', 'data-action': 'edit-appointment', 'data-id': item.id })
        );
        col.append(card);
      });
      week.append(col);
    });
    root.append(week);
    return root;
  }

  function lineRow(item) {
    const qty = item.qty != null ? item.qty : T.hundredthsToInput(item.qtyHundredths || 100);
    const price = item.unitPrice != null ? item.unitPrice : (item.unitCents != null ? T.centsToInput(item.unitCents) : '');
    const row = el('div', { class: 'line-row', 'data-id': item.id || '' });
    row.append(
      textInput('', item.description || '', { class: 'line-desc', placeholder: 'Description', 'aria-label': 'Description' }),
      textInput('', qty, { class: 'line-qty', inputmode: 'decimal', 'aria-label': 'Quantity' }),
      textInput('', price, { class: 'line-price', inputmode: 'decimal', 'aria-label': 'Unit price' }),
      el('div', { class: 'line-total', text: moneyOf(qty, price) || '—' }),
      el('button', { type: 'button', class: 'icon-btn', text: '×', 'aria-label': 'Remove line', 'data-action': 'remove-line' })
    );
    return row;
  }

  function updateTotals() {
    const form = document.getElementById('repair-form');
    if (!form) return;
    let total = 0;
    form.querySelectorAll('.line-row').forEach(function (row) {
      const qty = row.querySelector('.line-qty').value;
      const price = row.querySelector('.line-price').value;
      const label = moneyOf(qty, price);
      row.querySelector('.line-total').textContent = label || '—';
      const qtyH = T.qtyToHundredths(qty);
      const cents = T.dollarsToCents(price);
      if (label) total += T.lineTotalCents(qtyH, cents);
    });
    const node = document.getElementById('ro-total');
    if (node) node.textContent = T.formatMoney(total);
  }

  function readRepairForm() {
    const form = document.getElementById('repair-form');
    if (!form) return null;
    const lines = [];
    form.querySelectorAll('.line-row').forEach(function (row) {
      const description = row.querySelector('.line-desc').value.trim();
      const qty = row.querySelector('.line-qty').value.trim();
      const unitPrice = row.querySelector('.line-price').value.trim();
      if (!description && !unitPrice) return;
      lines.push({ id: row.getAttribute('data-id') || '', description: description, qty: qty, unitPrice: unitPrice });
    });
    return {
      id: form.getAttribute('data-id') || '',
      customer: document.getElementById('ro-customer').value,
      phone: document.getElementById('ro-phone').value,
      vehicle: document.getElementById('ro-vehicle').value,
      plate: document.getElementById('ro-plate').value,
      vin: document.getElementById('ro-vin').value,
      mileage: document.getElementById('ro-mileage').value,
      concern: document.getElementById('ro-concern').value,
      status: document.getElementById('ro-status').value,
      advisorComment: document.getElementById('ro-comment').value,
      lineItems: lines,
    };
  }

  function renderRepairs() {
    if (!ui.selectedId || !data.repairOrders.some(function (order) { return order.id === ui.selectedId; })) {
      const open = data.repairOrders.find(function (order) { return order.status === 'in-progress'; }) || data.repairOrders[0];
      ui.selectedId = open ? open.id : 'new';
    }
    const selected = data.repairOrders.find(function (order) { return order.id === ui.selectedId; }) || blankRepair();
    const root = el('div', { class: 'repair-layout' });
    const list = el('div', { class: 'stack' });
    list.append(el('button', { type: 'button', class: 'btn btn-primary', text: 'New repair order', 'data-action': 'new-ro' }));
    const scroll = el('div', { class: 'ro-scroll' });
    if (!data.repairOrders.length) scroll.append(el('p', { class: 'empty', text: 'No repair orders yet.' }));
    data.repairOrders.forEach(function (order) {
      scroll.append(el('button', {
        type: 'button',
        class: 'ro-item',
        'data-action': 'select-ro',
        'data-id': order.id,
        'aria-current': order.id === selected.id ? 'true' : 'false',
      }, [
        el('div', { class: 'card-head' }, [el('span', { class: 'ro-num', text: 'RO ' + order.number }), chip(order.status)]),
        el('div', { class: 'who', text: order.customer }),
        el('div', { class: 'sub', text: order.vehicle }),
      ]));
    });
    list.append(scroll);
    root.append(list);
    root.append(renderRepairDetail(selected));
    return root;
  }

  function blankRepair() {
    return {
      id: '',
      number: 'New',
      customer: '',
      phone: '',
      vehicle: '',
      plate: '',
      vin: '',
      mileage: '',
      concern: '',
      status: 'estimate',
      advisorComment: '',
      lineItems: [],
    };
  }

  function renderRepairDetail(order) {
    const status = el('select', { id: 'ro-status' });
    Object.keys(STATUS_LABEL).forEach(function (key) {
      const option = el('option', { value: key, text: STATUS_LABEL[key] });
      if (key === order.status) option.selected = true;
      status.append(option);
    });
    const lines = el('div', { class: 'lines', id: 'lines' });
    (order.lineItems || []).forEach(function (item) { lines.append(lineRow(item)); });
    if (!order.lineItems || !order.lineItems.length) lines.append(lineRow({ description: '', qty: '1', unitPrice: '' }));
    const form = el('div', { id: 'repair-form', 'data-id': order.id || '' });
    form.append(el('div', { class: 'ro-head' }, [
      el('div', {}, [
        el('div', { class: 'ro-num', text: order.id ? 'RO ' + order.number : 'New repair order' }),
        el('div', { class: 'sub', text: order.customer || "Craig's Leaside Automotive" }),
      ]),
      order.id ? chip(order.status) : null,
    ]));
    form.append(el('div', { class: 'form-grid' }, [
      field('Customer', textInput('ro-customer', order.customer)),
      field('Phone', textInput('ro-phone', order.phone)),
      field('Vehicle', textInput('ro-vehicle', order.vehicle)),
      field('Plate', textInput('ro-plate', order.plate)),
      field('VIN', textInput('ro-vin', order.vin)),
      field('Odometer (km)', textInput('ro-mileage', order.mileage == null ? '' : order.mileage)),
      field('Concern', area('ro-concern', order.concern), true),
      field('Status', status),
      field('Advisor note', area('ro-comment', order.advisorComment), true),
    ]));
    form.append(el('div', { class: 'section-label', text: 'Lines' }));
    form.append(lines);
    form.append(el('div', { class: 'toolbar' }, [
      el('button', { type: 'button', class: 'btn btn-ghost', text: 'Add line', 'data-action': 'add-line' }),
      el('div', { class: 'totals', text: 'Total ' }),
    ]));
    const total = form.querySelector('.totals');
    total.append(el('strong', { id: 'ro-total', text: '$0.00' }));
    form.append(el('div', { class: 'section-label', text: 'Gemini note' }));
    form.append(field('Instruction', textInput('ai-instruction', '', { placeholder: 'Shorter, or mention the rotors are on order' }), true));
    form.append(el('div', { class: 'draft-actions' }, [
      el('button', { type: 'button', class: 'btn btn-ghost', text: 'Draft with Gemini', 'data-action': 'draft-comment' }),
      el('button', { type: 'button', class: 'btn btn-ghost', text: 'Use draft', id: 'use-draft', hidden: true }),
    ]));
    form.append(el('div', { id: 'comment-preview', class: 'draft', hidden: true }));
    form.append(el('div', { class: 'toolbar' }, [
      el('button', { type: 'button', class: 'btn btn-primary', text: 'Save repair order', 'data-action': 'save-ro' }),
      el('button', { type: 'button', class: 'btn btn-ghost', text: 'Export PDF', 'data-action': 'export-pdf' }),
      order.id ? el('button', { type: 'button', class: 'btn btn-danger', text: 'Delete', 'data-action': 'delete-ro' }) : null,
    ]));
    const card = el('section', { class: 'card' }, [form]);
    setTimeout(updateTotals, 0);
    return card;
  }

  function renderDiagnostics() {
    const formCard = el('section', { class: 'card stack' }, [
      el('h2', { text: 'Symptom' }),
      el('p', { class: 'muted small', text: 'The checklist runs locally. Gemini only drafts a note when you ask, and only if a key is saved.' }),
      field('Vehicle', textInput('diag-vehicle', ui.diagForm.vehicle)),
      field('What is it doing?', area('diag-symptoms', ui.diagForm.symptoms, { placeholder: 'Pulls left while braking, pedal pulsates' })),
      field('Anything else', area('diag-notes', ui.diagForm.notes)),
      el('div', { class: 'draft-actions' }, [
        el('button', { type: 'button', class: 'btn btn-primary', text: 'Run local check', 'data-action': 'diagnose-local' }),
        el('button', { type: 'button', class: 'btn btn-ghost', text: 'Draft with Gemini', 'data-action': 'diagnose-gemini' }),
      ]),
    ]);
    const result = el('section', { class: 'card stack' });
    if (!ui.diag) {
      result.append(
        el('h2', { text: 'Checklist' }),
        el('p', { class: 'muted', text: 'Results stay on this computer. A saved Gemini key is optional and is not required to run the checklist.' })
      );
    } else {
      const local = ui.diag.local;
      result.append(
        el('h2', { text: local.matches.join(' · ') }),
        el('p', { text: local.summary }),
        el('h3', { text: 'Look at' }),
        el('ul', { class: 'check-list' }, local.systems.map(function (item) { return el('li', { text: item }); })),
        el('h3', { text: 'Checks' }),
        el('ol', { class: 'result-list' }, local.steps.map(function (item) { return el('li', { text: item }); })),
        el('h3', { text: 'Ask the customer' }),
        el('ul', { class: 'check-list' }, local.questions.map(function (item) { return el('li', { text: item }); }))
      );
      local.safety.forEach(function (item) { result.append(el('div', { class: 'safety', text: item })); });
      if (ui.diag.note) result.append(el('h3', { text: 'Gemini note' }), el('div', { class: 'draft', text: ui.diag.note }));
      if (ui.diag.noteError) result.append(el('p', { class: 'safety', text: ui.diag.noteError }));
    }
    return el('div', { class: 'diag-grid' }, [formCard, result]);
  }

  function renderSettings() {
    const settings = data.settings;
    const secrets = data.secretStatus;
    const storage = secrets.storage === 'os-keychain'
      ? 'Saved with the operating system keychain.'
      : 'OS keychain is unavailable here. Secrets are encrypted in a local key file in the app data folder, not in the project.';
    const keyNote = secrets.gemini === 'saved'
      ? 'A key is saved (' + secrets.geminiHint + '). Enter a new one only to replace it.'
      : secrets.gemini === 'environment'
        ? 'Using the key from the environment (' + secrets.geminiHint + '). A key saved here replaces it.'
        : 'No key saved. Local diagnostics still work.';
    const loginNote = secrets.hasTekmetricPassword
      ? 'Login saved for ' + secrets.tekmetricEmail + '.'
      : 'No Tekmetric login saved. The site still opens for a manual sign-in.';
    return el('div', { class: 'settings-grid' }, [
      el('section', { class: 'card stack', id: 'settings-shop' }, [
        el('h2', { text: 'Letterhead' }),
        el('p', { class: 'muted small', text: 'Printed on work-order PDFs. These details are the shop’s public listing.' }),
        field('Shop name', textInput('set-name', settings.shopName)),
        field('Address', textInput('set-address', settings.address)),
        field('City', textInput('set-city', settings.city)),
        field('Phone', textInput('set-phone', settings.phone)),
        field('Email', textInput('set-email', settings.email, { type: 'email' })),
        el('button', { type: 'button', class: 'btn btn-primary', text: 'Save letterhead', 'data-action': 'save-settings' }),
      ]),
      el('section', { class: 'card stack' }, [
        el('h2', { text: 'Gemini' }),
        el('p', { class: 'muted small', text: keyNote }),
        field('Model', textInput('set-model', settings.geminiModel)),
        field('API key', textInput('set-key', '', { type: 'password', autocomplete: 'off', placeholder: 'Leave blank to keep the saved key' })),
        el('div', { class: 'draft-actions' }, [
          el('button', { type: 'button', class: 'btn btn-primary', text: 'Save Gemini settings', 'data-action': 'save-gemini' }),
          el('button', { type: 'button', class: 'btn btn-ghost', text: 'Remove saved key', 'data-action': 'clear-key' }),
        ]),
        el('p', { class: 'small muted', text: storage }),
        secrets.locked ? el('p', { class: 'safety', text: 'Saved secrets could not be unlocked on this computer.' }) : null,
      ]),
      el('section', { class: 'card stack' }, [
        el('h2', { text: 'Tekmetric sign-in' }),
        el('p', { class: 'muted small', text: loginNote + ' The password is only typed into https://shop.tekmetric.com (or app/login.tekmetric.com). It is not sent anywhere else.' }),
        field('Shop URL', textInput('set-url', settings.tekmetricUrl)),
        field('Email', textInput('set-login-email', '', { type: 'email', autocomplete: 'off', placeholder: secrets.tekmetricEmail || 'name@shop.com' })),
        field('Password', textInput('set-login-password', '', { type: 'password', autocomplete: 'off', placeholder: secrets.hasTekmetricPassword ? 'Saved' : '' })),
        el('div', { class: 'draft-actions' }, [
          el('button', { type: 'button', class: 'btn btn-primary', text: 'Save login', 'data-action': 'save-login' }),
          el('button', { type: 'button', class: 'btn btn-ghost', text: 'Remove login', 'data-action': 'clear-login' }),
          el('button', { type: 'button', class: 'btn btn-ghost', text: 'Open Tekmetric', 'data-action': 'open-tekmetric' }),
        ]),
      ]),
      el('section', { class: 'card stack' }, [
        el('h2', { text: 'Updates' }),
        el('p', { class: 'muted small', text: data.app.packaged
          ? 'Version ' + data.app.version + '. Updates install only after you download one.'
          : 'Version ' + data.app.version + '. This is a source checkout, so update checks wait until the app is installed.' }),
        el('div', { class: 'draft-actions' }, [
          el('button', { type: 'button', class: 'btn btn-primary', text: 'Check for updates', 'data-action': 'check-updates' }),
          el('button', { type: 'button', class: 'btn btn-ghost', text: 'Download update', 'data-action': 'download-update' }),
          el('button', { type: 'button', class: 'btn btn-ghost', text: 'Restart and install', 'data-action': 'install-update' }),
        ]),
        el('button', { type: 'button', class: 'btn btn-ghost', text: 'Remove starter jobs', 'data-action': 'clear-samples' }),
      ]),
    ]);
  }

  function render() {
    if (!data) return;
    setNav();
    applyDark(data.settings.darkMode);
    const view = document.getElementById('view');
    const body = {
      dashboard: renderDashboard,
      calendar: renderCalendar,
      repairs: renderRepairs,
      diagnostics: renderDiagnostics,
      settings: renderSettings,
    }[ui.view] || renderDashboard;
    view.replaceChildren(body());
    if (ui.view === 'repairs') updateTotals();
    const version = document.getElementById('side-version');
    if (data.app) version.textContent = 'Version ' + data.app.version;
  }

  async function refresh(next) {
    if (!next) {
      const result = await api.getState();
      if (!result.ok) {
        document.getElementById('view').replaceChildren(el('div', { class: 'empty' }, [
          el('h2', { text: 'Could not open the shop file' }),
          el('p', { text: result.error || 'Try again.' }),
          el('button', { type: 'button', class: 'btn btn-primary', text: 'Retry', onclick: function () { refresh(); } }),
        ]));
        return;
      }
      next = result.data;
    }
    data = next;
    window.__ready = true;
    render();
  }

  async function showView(view) {
    if (!VIEWS[view] || !data) return;
    if (ui.dirty && view !== ui.view) {
      const ok = await ask({
        title: 'Discard unsaved changes?',
        body: 'The repair order has edits that are not saved.',
        confirmLabel: 'Discard',
        danger: true,
      });
      if (!ok) return;
      ui.dirty = false;
    }
    ui.view = view;
    render();
  }

  async function toggleDark() {
    const next = !data.settings.darkMode;
    const result = await api.saveSettings(Object.assign({}, data.settings, { darkMode: next }));
    if (!result.ok) { toast(result.error || 'Could not save appearance.', true); return; }
    data.settings.darkMode = next;
    applyDark(next);
  }

  function currentSettings() {
    return {
      shopName: document.getElementById('set-name') ? document.getElementById('set-name').value : data.settings.shopName,
      address: document.getElementById('set-address') ? document.getElementById('set-address').value : data.settings.address,
      city: document.getElementById('set-city') ? document.getElementById('set-city').value : data.settings.city,
      phone: document.getElementById('set-phone') ? document.getElementById('set-phone').value : data.settings.phone,
      email: document.getElementById('set-email') ? document.getElementById('set-email').value : data.settings.email,
      darkMode: data.settings.darkMode,
      geminiModel: document.getElementById('set-model') ? document.getElementById('set-model').value : data.settings.geminiModel,
      tekmetricUrl: document.getElementById('set-url') ? document.getElementById('set-url').value : data.settings.tekmetricUrl,
    };
  }

  async function saveCurrentSettings() {
    const result = await api.saveSettings(currentSettings());
    if (!result.ok) { toast(result.error, true); return null; }
    data = result.data;
    return result.data;
  }

  async function onClick(event) {
    const actionEl = event.target.closest('[data-action]');
    if (!actionEl || !data) return;
    const action = actionEl.getAttribute('data-action');
    if (action === 'toggle-done') {
      const result = await api.toggleAppointment(actionEl.getAttribute('data-id'));
      if (!result.ok) toast(result.error, true);
      else { data = result.data; ui.dirty = false; render(); }
      return;
    }
    if (action === 'add-appointment') { await editAppointment(null, actionEl.getAttribute('data-date')); return; }
    if (action === 'edit-appointment') {
      const found = data.appointments.find(function (item) { return item.id === actionEl.getAttribute('data-id'); });
      if (found) await editAppointment(found);
      return;
    }
    if (action === 'week-prev') { ui.weekOffset -= 1; render(); return; }
    if (action === 'week-next') { ui.weekOffset += 1; render(); return; }
    if (action === 'week-today') { ui.weekOffset = 0; render(); return; }
    if (action === 'open-ro' || action === 'select-ro') {
      if (ui.dirty) {
        const ok = await ask({ title: 'Discard unsaved changes?', body: 'The open repair order has edits that are not saved.', confirmLabel: 'Discard', danger: true });
        if (!ok) return;
      }
      ui.dirty = false;
      ui.selectedId = actionEl.getAttribute('data-id');
      ui.view = 'repairs';
      render();
      return;
    }
    if (action === 'new-ro') {
      if (ui.dirty) {
        const ok = await ask({ title: 'Discard unsaved changes?', confirmLabel: 'Discard', danger: true });
        if (!ok) return;
      }
      ui.dirty = false;
      ui.selectedId = 'new';
      ui.view = 'repairs';
      render();
      return;
    }
    if (action === 'add-line') {
      document.getElementById('lines').append(lineRow({ description: '', qty: '1', unitPrice: '' }));
      ui.dirty = true;
      updateTotals();
      return;
    }
    if (action === 'remove-line') {
      const row = actionEl.closest('.line-row');
      const host = document.getElementById('lines');
      if (host.children.length === 1) {
        row.querySelector('.line-desc').value = '';
        row.querySelector('.line-qty').value = '1';
        row.querySelector('.line-price').value = '';
      } else row.remove();
      ui.dirty = true;
      updateTotals();
      return;
    }
    if (action === 'save-ro') { await saveRepair(); return; }
    if (action === 'delete-ro') { await deleteRepair(); return; }
    if (action === 'export-pdf') { await exportPdf(); return; }
    if (action === 'draft-comment') { await draftComment(); return; }
    if (action === 'diagnose-local') { await runDiagnose(false); return; }
    if (action === 'diagnose-gemini') { await runDiagnose(true); return; }
    if (action === 'dismiss-notice') {
      const result = await api.dismissNotice();
      if (result.ok) { data = result.data; render(); }
      return;
    }
    if (action === 'clear-samples') {
      const ok = await ask({ title: 'Remove starter jobs?', body: 'Jobs you have edited are kept. Untouched starter jobs are removed.', confirmLabel: 'Remove', danger: true });
      if (!ok) return;
      const result = await api.clearSamples();
      if (!result.ok) toast(result.error, true);
      else { data = result.data; ui.selectedId = null; ui.dirty = false; toast('Starter jobs removed.'); render(); }
      return;
    }
    if (action === 'save-settings' || action === 'save-gemini' || action === 'save-login') {
      if (action === 'save-gemini') {
        const key = document.getElementById('set-key').value;
        if (key) {
          const secret = await api.saveSecrets({ geminiApiKey: key });
          if (!secret.ok) { toast(secret.error, true); return; }
          data = secret.data;
        }
      }
      if (action === 'save-login') {
        const patch = {};
        const email = document.getElementById('set-login-email').value.trim();
        const password = document.getElementById('set-login-password').value;
        if (email) patch.tekmetricEmail = email;
        if (password) patch.tekmetricPassword = password;
        if (email || password) {
          const secret = await api.saveSecrets(patch);
          if (!secret.ok) { toast(secret.error, true); return; }
          data = secret.data;
        }
      }
      const savedSettings = await saveCurrentSettings();
      if (savedSettings) { toast('Saved.'); render(); }
      return;
    }
    if (action === 'clear-key') {
      const result = await api.saveSecrets({ geminiApiKey: null });
      if (!result.ok) toast(result.error, true);
      else { data = result.data; toast('Saved key removed.'); render(); }
      return;
    }
    if (action === 'clear-login') {
      const result = await api.saveSecrets({ tekmetricEmail: null, tekmetricPassword: null });
      if (!result.ok) toast(result.error, true);
      else { data = result.data; toast('Saved login removed.'); render(); }
      return;
    }
    if (action === 'open-tekmetric') {
      const result = await api.openTekmetric();
      if (!result.ok) toast(result.error, true);
      else toast(result.message);
      return;
    }
    if (action === 'check-updates') {
      const result = await api.checkForUpdates();
      toast((result.data && result.data.message) || result.error || 'Checked.', !result.ok);
      return;
    }
    if (action === 'download-update') {
      const result = await api.downloadUpdate();
      toast((result.data && result.data.message) || result.error || 'Downloading.', !result.ok);
      return;
    }
    if (action === 'install-update') {
      const result = await api.installUpdate();
      if (!result.ok) toast(result.error, true);
      return;
    }
  }

  async function editAppointment(existing, date) {
    const values = await ask({
      title: existing ? 'Edit appointment' : 'New appointment',
      confirmLabel: existing ? 'Save' : 'Add',
      extraLabel: existing ? 'Delete' : '',
      fields: [
        { name: 'date', label: 'Date', type: 'date', value: existing ? existing.date : (date || data.shopClock.iso) },
        { name: 'time', label: 'Time', type: 'time', value: existing ? existing.time : '08:00' },
        { name: 'customer', label: 'Customer', value: existing ? existing.customer : '' },
        { name: 'vehicle', label: 'Vehicle', value: existing ? existing.vehicle : '' },
        { name: 'service', label: 'Service', value: existing ? existing.service : '', spell: true, capitalize: true, wide: true },
        { name: 'notes', label: 'Notes', type: 'textarea', value: existing ? existing.notes : '', wide: true },
        { name: 'done', label: 'Mark done', type: 'checkbox', value: existing ? existing.done : false },
      ],
    });
    if (!values) return;
    if (values.__extra && existing) {
      const result = await api.deleteAppointment(existing.id);
      if (!result.ok) toast(result.error, true);
      else { data = result.data; render(); }
      return;
    }
    const result = await api.saveAppointment({
      id: existing ? existing.id : '',
      date: values.date,
      time: String(values.time || '').slice(0, 5),
      customer: values.customer,
      vehicle: values.vehicle,
      service: values.service,
      notes: values.notes,
      done: values.done,
    });
    if (!result.ok) toast(result.error, true);
    else { data = result.data; toast('Appointment saved.'); render(); }
  }

  async function saveRepair() {
    const payload = readRepairForm();
    const result = await api.saveRepair(payload);
    if (!result.ok) { toast(result.error, true); return; }
    ui.dirty = false;
    if (payload.id) ui.selectedId = payload.id;
    else if (result.data.repairOrders[0]) ui.selectedId = result.data.repairOrders[0].id;
    data = result.data;
    toast('Repair order saved.');
    render();
  }

  async function deleteRepair() {
    const id = document.getElementById('repair-form').getAttribute('data-id');
    if (!id) return;
    const ok = await ask({ title: 'Delete this repair order?', body: 'This removes it from this computer.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    const result = await api.deleteRepair(id);
    if (!result.ok) toast(result.error, true);
    else { ui.dirty = false; ui.selectedId = null; data = result.data; toast('Repair order deleted.'); render(); }
  }

  async function exportPdf() {
    const form = document.getElementById('repair-form');
    const id = form.getAttribute('data-id');
    if (!id) { toast('Save the repair order before exporting.', true); return; }
    if (ui.dirty) { toast('Save changes before exporting.', true); return; }
    const result = await api.exportPdf(id);
    if (result.cancelled) return;
    if (!result.ok) toast(result.error, true);
    else toast('Saved ' + String(result.data.file).split(/[\\/]/).pop());
  }

  async function draftComment() {
    const repair = readRepairForm();
    const button = document.querySelector('[data-action="draft-comment"]');
    if (button) button.disabled = true;
    const result = await api.draftComment({
      repair: repair,
      instruction: document.getElementById('ai-instruction').value,
    });
    if (button) button.disabled = false;
    if (!result.ok) { toast(result.error, true); return; }
    const preview = document.getElementById('comment-preview');
    const use = document.getElementById('use-draft');
    preview.hidden = false;
    preview.textContent = result.data.text;
    use.hidden = false;
    use.onclick = function () {
      document.getElementById('ro-comment').value = result.data.text;
      ui.dirty = true;
      toast('Draft placed in the note. Save the repair order to keep it.');
    };
  }

  async function runDiagnose(useGemini) {
    ui.diagForm = {
      vehicle: document.getElementById('diag-vehicle').value,
      symptoms: document.getElementById('diag-symptoms').value,
      notes: document.getElementById('diag-notes').value,
    };
    const button = document.querySelector(useGemini ? '[data-action="diagnose-gemini"]' : '[data-action="diagnose-local"]');
    if (button) button.disabled = true;
    const result = await api.diagnose(Object.assign({ useGemini: useGemini }, ui.diagForm));
    if (!result.ok) { toast(result.error, true); if (button) button.disabled = false; return; }
    ui.diag = result.data;
    render();
  }

  function onInput(event) {
    if (event.target.closest('#repair-form')) ui.dirty = true;
    if (event.target.classList && (event.target.classList.contains('line-qty') || event.target.classList.contains('line-price') || event.target.classList.contains('line-desc'))) {
      updateTotals();
    }
  }

  function onBlur(event) {
    const target = event.target;
    if (!target.matches || !target.matches('[data-capitalize="true"]')) return;
    const next = T.autoCapitalize(target.value);
    if (next !== target.value) target.value = next;
  }

  function boot() {
    if (!api || !T) {
      document.body.textContent = 'This screen only runs inside Tekmetric Pro.';
      return;
    }
    document.querySelectorAll('.nav-btn').forEach(function (button) {
      button.addEventListener('click', function () { showView(button.getAttribute('data-view')); });
    });
    document.getElementById('dark-toggle').addEventListener('click', toggleDark);
    document.getElementById('view').addEventListener('click', onClick);
    document.getElementById('view').addEventListener('input', onInput);
    document.getElementById('view').addEventListener('focusout', onBlur);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeModal();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && ui.view === 'repairs') {
        event.preventDefault();
        saveRepair();
      }
    });
    api.onNavigate(function (view) { showView(view); });
    api.onUpdate(function (status) {
      if (status && status.message) toast(status.message, status.state === 'error');
    });
    window.__showView = function (view) {
      ui.dirty = false;
      ui.view = VIEWS[view] ? view : 'dashboard';
      render();
      return true;
    };
    window.__setDark = function (on) {
      if (data) data.settings.darkMode = Boolean(on);
      applyDark(on);
      return true;
    };
    refresh();
  }

  boot();
})();
