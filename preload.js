const { ipcRenderer } = require('electron');

const urlParams = new URLSearchParams(window.location.search);
const hiddenCopies = parseInt(urlParams.get('copies')) || 1;
const isHiddenPrinter = window.location.search.includes('hiddenPrinter=true');

let appSettings = { darkMode: false, autoCaps: true, hidePremium: true, showSidebar: true, presets: [] };
try {
    appSettings = ipcRenderer.sendSync('get-settings') || appSettings;
} catch (err) {
    console.warn('Settings could not be loaded yet.');
}
let lastActiveInput = null;

document.addEventListener('focusin', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        lastActiveInput = e.target;
    }
});

function forceNativeInput(el, val, isAutoCaps = false) {
    const activeBefore = document.activeElement;
    const lastValue = el.value;
    const proto = el.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;

    if (!isAutoCaps) el.focus();
    
    setter.call(el, val);

    if (el._valueTracker) {
        el._valueTracker.setValue(lastValue);
    }

    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

    const propKey = Object.keys(el).find((key) => key.indexOf('__reactProps') === 0);
    const props = propKey ? el[propKey] : null;
    if (props && typeof props.onChange === 'function') {
        try {
            props.onChange({ target: el, currentTarget: el });
        } catch (err) {
            /* The box still has the text if the page uses a different handler. */
        }
    }
    
    if (!isAutoCaps) {
        el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' }));
        
        setTimeout(() => {
            el.blur();
            if (activeBefore && typeof activeBefore.focus === 'function') {
                activeBefore.focus(); 
            }
        }, 50);
    }
}

const injectText = (textToInsert) => {
    if (lastActiveInput && document.body.contains(lastActiveInput)) {
        let currentVal = (lastActiveInput.value || "").trim();
        
        if (currentVal !== "" && !currentVal.endsWith('+') && !currentVal.endsWith(',')) {
            currentVal += " + ";
        } else if (currentVal !== "") {
            currentVal += " ";
        }
        
        const newVal = currentVal + textToInsert + " + ";
        forceNativeInput(lastActiveInput, newVal);
        lastActiveInput.focus();
    } else {
        alert('Click inside a text box first to inject text.');
    }
};

ipcRenderer.on('settings-changed', (event, newSettings) => {
    appSettings = newSettings;
    
    if (!appSettings.hidePremium) {
        document.querySelectorAll('.leaside-hidden').forEach(el => {
            el.classList.remove('leaside-hidden');
            el.style.removeProperty('display');
        });
    } else {
        cleanUpInterface();
    }
    toggleSidebarVisibility();
});

ipcRenderer.on('fill-no-faults', () => {
    document.querySelectorAll('textarea').forEach(ta => {
        if (!ta.value || ta.value.trim() === '') {
            forceNativeInput(ta, 'No faults found at this time.');
        }
    });
});

ipcRenderer.on('clear-no-faults', () => {
    document.querySelectorAll('textarea').forEach(ta => {
        const val = (ta.value || "").toUpperCase();
        if (val === 'NO FAULTS FOUND AT THIS TIME.') {
            forceNativeInput(ta, '');
        }
    });
});

ipcRenderer.on('insert-text', (event, textToInsert) => {
    injectText(textToInsert);
});

function injectShopBranding() {
    if (document.getElementById('shop-logo-fixed')) return;
    const img = document.createElement('img');
    img.id = 'shop-logo-fixed';
    img.src = 'local-resource://logo.png';
    img.style.cssText = "position:fixed; top:8px; left:220px; width:45px; z-index:2147483647; pointer-events:none; opacity: 0.9;";
    document.body.appendChild(img);
}

function injectCustomStyles() {
    if (document.getElementById('leaside-custom-styles')) return;
    const style = document.createElement('style');
    style.id = 'leaside-custom-styles';
    style.innerHTML = `
        .leaside-completed-job {
            background-color: #2c0000 !important;
            box-shadow: inset 0 0 0 1.5px #000000 !important;
            opacity: 0.9 !important;
        }
        .leaside-completed-job .rbc-event-content,
        .leaside-checkedin-job .rbc-event-content {
            display: flex !important;
            flex-direction: column !important;
            align-items: flex-start !important;
        }
        .leaside-completed-job .rbc-event-content::before {
            content: "[Completed]";
            display: inline-block;
            font-weight: bold;
            font-size: 13px;
            color: #ffb3b3;
            background-color: #000000;
            padding: 2px 5px;
            border-radius: 4px;
            text-decoration: none !important;
            margin-bottom: 2px;
        }
        .leaside-completed-job .rbc-event-label,
        .leaside-completed-job .rbc-event-content > div {
            color: #ffffff !important;
            width: 100%;
        }
        .leaside-checkedin-job .rbc-event-content::before {
            content: "[Checked In]";
            display: inline-block;
            font-weight: bold;
            font-size: 13px;
            color: #66bb6a; 
            background-color: #000000;
            padding: 2px 5px;
            border-radius: 4px;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.8); 
            text-decoration: none !important;
            margin-bottom: 2px;
        }
        .leaside-checkedin-job .rbc-event-label,
        .leaside-checkedin-job .rbc-event-content > div {
            text-decoration: none !important;
            width: 100%;
        }
    `;
    document.head.appendChild(style);
}

function handleMarketingSource() {
    const sourceInputs = document.querySelectorAll('input[name="marketingSource"], input[placeholder*="Marketing Source"]');
    sourceInputs.forEach(sourceInput => {
        if (sourceInput && !sourceInput.value && !sourceInput.dataset.leasideFixed) {
            sourceInput.dataset.leasideFixed = "true";
            
            sourceInput.focus();
            sourceInput.click();
            
            forceNativeInput(sourceInput, 'Returning Customer');
            
            setTimeout(() => {
                const options = document.querySelectorAll('[role="option"], li');
                options.forEach(opt => {
                    if (opt.textContent.trim().toLowerCase() === 'returning customer') {
                        opt.click();
                    }
                });
                
                sourceInput.dispatchEvent(new KeyboardEvent('keydown', { 
                    bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' 
                }));
                
                setTimeout(() => sourceInput.blur(), 100);
            }, 400);
        }
    });
}

function syncJobBoardData() {
    const url = window.location.href.toLowerCase();
    
    // --- 1. Aggressively scrape the Job Board and store EXACT names ---
    if (url.includes('repair-orders') || url.includes('board=')) {
        const anyCardsOnBoard = document.querySelectorAll('[data-repair-order-index], .MuiCard-root').length > 0;
        if (anyCardsOnBoard) {
            let unpaidNames = [];
            document.querySelectorAll('[data-repair-order-status="COMPLETE"], .MuiCard-root').forEach(card => {
                let text = (card.textContent || "").toLowerCase();
                const isCompleted = card.getAttribute('data-repair-order-status') === 'COMPLETE' || text.includes('completed');
                
                if (isCompleted && text.includes('balance due')) {
                    // Isolates the exact name from the card bullet point
                    let namePart = text.split('•')[0].replace(/completed/g, '').replace(/in progress/g, '').trim();
                    if (namePart && !unpaidNames.includes(namePart)) {
                        unpaidNames.push(namePart);
                    }
                }
            });
            // Changed registry key to force a clean slate for the array memory
            localStorage.setItem('leaside-unpaid-names', JSON.stringify(unpaidNames));
        }
    }
    
    // --- 2. Dynamically purge memory if an RO is open and paid ---
    if (url.includes('/repair/')) {
        const bodyText = document.body.textContent.toLowerCase();
        const isPaid = bodyText.match(/balance due[:\s]*\$0\.00/i) || bodyText.includes('paid in full') || bodyText.includes('posted');
        
        if (isPaid) {
            const custEl = document.querySelector('[data-testid="customer-name"]') || document.querySelector('.MuiTypography-h4');
            if (custEl) {
                const roCustName = custEl.textContent.trim().toLowerCase();
                let savedUnpaid = JSON.parse(localStorage.getItem('leaside-unpaid-names') || "[]");
                
                // Immediately remove this customer from memory so they cross off instantly
                const newUnpaid = savedUnpaid.filter(name => !name.includes(roCustName) && !roCustName.includes(name));
                if (newUnpaid.length !== savedUnpaid.length) {
                    localStorage.setItem('leaside-unpaid-names', JSON.stringify(newUnpaid));
                }
            }
        }
    }
    
    // --- 3. Process the Calendar Appointments ---
    if (url.includes('appointments') || document.querySelector('.rbc-calendar')) {
        const savedUnpaidNames = JSON.parse(localStorage.getItem('leaside-unpaid-names') || "[]");
        
        document.querySelectorAll('.rbc-event').forEach(eventCard => {
            const isCompleted = eventCard.querySelector('svg[data-testid="PlaylistAddCheckIcon"]');
            
            const oldMoney = eventCard.querySelector('.leaside-money-icon');
            if (oldMoney) oldMoney.remove();
            const oldX = eventCard.querySelector('.leaside-x-mark');
            if (oldX) oldX.remove();
            
            eventCard.classList.remove('leaside-paid-job');
            eventCard.style.boxShadow = ''; 
            eventCard.style.textDecoration = 'none';

            if (isCompleted) {
                const calTextRaw = eventCard.textContent || "";
                
                // Perfectly slices off everything after the name ('s, -, or stray spaces)
                let customerName = calTextRaw.toLowerCase().split(/'s\s|\s-\s|-/)[0].trim();
                
                let isUnpaid = savedUnpaidNames.some(unpaidName => {
                    return customerName.includes(unpaidName) || unpaidName.includes(customerName);
                });

                if (!isUnpaid) {
                    eventCard.classList.add('leaside-paid-job');
                    eventCard.style.textDecoration = 'line-through';
                    
                    const icon = document.createElement('div');
                    icon.className = 'leaside-money-icon';
                    icon.textContent = '💰';
                    icon.style.cssText = 'position: absolute; top: 32px; right: 4px; font-size: 1.5rem; z-index: 999; pointer-events: none; filter: drop-shadow(1px 1px 2px rgba(0,0,0,0.6)); text-decoration: none;';
                    eventCard.appendChild(icon);
                } else {
                    eventCard.style.boxShadow = 'inset 0 0 0 2.5px #ff9800'; 
                }

                const xMark = document.createElement('div');
                xMark.className = 'leaside-x-mark';
                xMark.textContent = '❌';
                xMark.style.cssText = 'position: absolute; top: 4px; right: 4px; font-size: 1.6rem; opacity: 1.0; pointer-events: none; z-index: 999; text-decoration: none;';
                eventCard.appendChild(xMark);
            }
        });
    }
}

function crossOffFinishedJobs() {
    document.querySelectorAll('.rbc-event').forEach(eventCard => {
        const textData = (eventCard.textContent || "").toLowerCase();
        const isCompleted = eventCard.querySelector('svg[data-testid="PlaylistAddCheckIcon"]');
        const isCheckedIn = eventCard.querySelector('svg[data-testid="CheckIcon"]') || textData.includes('checked in');
        
        if (isCompleted) {
            eventCard.classList.remove('leaside-checkedin-job');
            eventCard.classList.add('leaside-completed-job');
        } else if (isCheckedIn) {
            eventCard.classList.remove('leaside-completed-job');
            eventCard.classList.add('leaside-checkedin-job');
        } else {
            eventCard.classList.remove('leaside-completed-job', 'leaside-checkedin-job');
        }
    });

    const finishedStatuses = ["completed", "paid", "invoiced", "picked up"];
    
    document.querySelectorAll('.MuiCard-root, [data-repair-order-index]').forEach(card => {
        const cardText = (card.textContent || "").toLowerCase();
        const isJobBoardCard = card.hasAttribute('data-repair-order-index');
        const isJobBoardCompleted = card.getAttribute('data-repair-order-status') === 'COMPLETE';

        let hasStatusText = false;
        if (!isJobBoardCard) {
            hasStatusText = Array.from(card.querySelectorAll('span, p, div')).some(el => {
                if (el.children.length > 1) return false;
                const text = el.textContent.trim().toLowerCase();
                return finishedStatuses.includes(text);
            });
        }

        const isFinished = hasStatusText || isJobBoardCompleted;
        const hasBalanceDue = cardText.includes('balance due');

        if (isFinished) {
            let titleArea = card.querySelector('h6, p, span, .font-medium');
            if (!titleArea) titleArea = card; 

            if (!card.querySelector('.leaside-x-mark')) {
                const xMark = document.createElement('span');
                xMark.className = 'leaside-x-mark';
                xMark.textContent = ' ❌';
                xMark.style.color = '#ff4444';
                xMark.style.textDecoration = 'none';
                xMark.style.fontWeight = 'bold';
                titleArea.appendChild(xMark);
            }

            if (hasBalanceDue) {
                card.style.opacity = '1';
                card.style.textDecoration = 'none';
                const oldMoney = card.querySelector('.leaside-money-icon');
                if (oldMoney) oldMoney.remove();
            } else {
                card.style.opacity = '0.5';
                card.style.textDecoration = 'line-through';
                if (!card.querySelector('.leaside-money-icon')) {
                    const icon = document.createElement('div');
                    icon.className = 'leaside-money-icon';
                    icon.textContent = '💰';
                    card.style.position = 'relative';
                    icon.style.cssText = 'position: absolute; top: 10px; right: 10px; font-size: 1.5rem; z-index: 999; pointer-events: none; filter: drop-shadow(1px 1px 2px rgba(0,0,0,0.6)); text-decoration: none;';
                    card.appendChild(icon);
                }
            }
        } else {
            card.style.opacity = '1';
            card.style.textDecoration = 'none';
            const oldMoney = card.querySelector('.leaside-money-icon');
            if (oldMoney) oldMoney.remove();
            const oldX = card.querySelector('.leaside-x-mark');
            if (oldX) oldX.remove();
        }
    });
}

function cleanUpInterface() {
    if (!appSettings.hidePremium) return;

    const premiumSidebars = ["Fluids", "Filters & Blades", "Tires", "Batteries", "Specs", "Service Bulletin"];
    const leftNav = ["Shop Dashboard", "Tech Board"];
    
    document.querySelectorAll('.MuiAccordion-root').forEach(acc => {
        const summary = acc.querySelector('.MuiAccordionSummary-content');
        if (summary) {
            const text = summary.textContent.trim();
            if (premiumSidebars.some(t => text.startsWith(t) || text === t + " ✎")) {
                if (!acc.classList.contains('leaside-hidden')) {
                    acc.classList.add('leaside-hidden');
                    acc.style.setProperty('display', 'none', 'important');
                }
            }
        }
    });

    document.querySelectorAll('.MuiListItem-root, a[href]').forEach(el => {
        if (el.children.length > 3) return; 
        const text = el.textContent.trim();
        if (leftNav.some(t => text === t || text.startsWith(t + " ") || text.startsWith(t + "\n"))) {
            if (!el.classList.contains('leaside-hidden')) {
                el.classList.add('leaside-hidden');
                el.style.setProperty('display', 'none', 'important');
            }
        }
    });
}

function enforceSpellcheck() {
    document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]').forEach(el => {
        if (el.getAttribute('spellcheck') !== 'true') {
            el.setAttribute('spellcheck', 'true');
        }
    });
}

function toggleSidebarVisibility() {
    const sidebar = document.getElementById('leaside-sidebar-tools');
    if (appSettings.showSidebar === false) {
        if (sidebar) sidebar.style.display = 'none';
    } else {
        if (sidebar) {
            sidebar.style.display = 'flex';
        } else {
            injectSidebarButtons();
        }
    }
}

function injectSidebarButtons() {
    if (document.getElementById('leaside-sidebar-tools')) return;
    if (appSettings.showSidebar === false) return;

    const container = document.createElement('div');
    container.id = 'leaside-sidebar-tools';
    
    container.style.cssText = 'position: fixed; bottom: 16px; left: 16px; padding: 14px; display: flex; flex-direction: column; gap: 6px; z-index: 2147483647; background: #ffffff; border: 1px solid #e0e0e0; border-radius: 8px; box-shadow: 0px 6px 20px rgba(0,0,0,0.15); width: 220px; transition: opacity 0.2s ease-in-out;';
    
    const title = document.createElement('div');
    title.textContent = 'QUICK ACTIONS';
    title.style.cssText = 'font-size: 11px; font-weight: bold; color: #777; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.5px;';
    container.appendChild(title);
    
    const createBtn = (label, onClick) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.cssText = 'background: transparent; border: 1px solid #ccc; padding: 6px; border-radius: 4px; cursor: pointer; text-align: left; font-size: 12px; color: #333; width: 100%; transition: background 0.2s;';
        btn.onmouseover = () => btn.style.background = '#e8e8e8';
        btn.onmouseout = () => btn.style.background = 'transparent';
        btn.onmousedown = onClick;
        return btn;
    };
    
    container.appendChild(createBtn('Fill "No Faults" (Ctrl+Alt+N)', (e) => {
        e.preventDefault();
        document.querySelectorAll('textarea').forEach(ta => {
            if (!ta.value || ta.value.trim() === '') {
                forceNativeInput(ta, 'No faults found at this time.');
            }
        });
    }));

    container.appendChild(createBtn('Undo "No Faults" (Ctrl+Alt+C)', (e) => {
        e.preventDefault();
        document.querySelectorAll('textarea').forEach(ta => {
            const val = (ta.value || "").toUpperCase();
            if (val === 'NO FAULTS FOUND AT THIS TIME.') {
                forceNativeInput(ta, '');
            }
        });
    }));

    const scrollBox = document.createElement('div');
    scrollBox.id = 'leaside-quick-scroll';
    scrollBox.style.cssText = 'display: flex; flex-direction: column; gap: 4px; padding-right: 8px; margin-top: 5px; border-top: 1px solid #eee; padding-top: 10px;';

    const presetJobs = appSettings.presets || [];

    presetJobs.forEach(jobText => {
        let label = jobText;
        if (jobText.length > 25) {
            label = jobText.substring(0, 22) + "...";
        }
        scrollBox.appendChild(createBtn('+ ' + label, (e) => {
            e.preventDefault();
            injectText(jobText);
        }));
    });

    container.appendChild(scrollBox);
    document.body.appendChild(container); 
}

let domTimer = null;

const runEnhancements = () => {
    try {
        injectShopBranding();
        injectCustomStyles();
        cleanUpInterface();
        crossOffFinishedJobs();
        syncJobBoardData();
        handleMarketingSource();
        enforceSpellcheck();
        toggleSidebarVisibility();
        
        const quickMenu = document.getElementById('leaside-sidebar-tools');
        const href = window.location.href.toLowerCase();
        
        const isDashboard = href.endsWith('/dashboard') || href.endsWith('/dashboard/') || href.endsWith('.com') || href.endsWith('.com/');
        const isDocumentView = href.includes('/document/') || href.startsWith('blob:') || href.includes('.pdf');
        const isPartsPopup = href.includes('partstech') || href.includes('nexpart') || window.opener !== null;
        
        const hasSidebar = document.querySelector('nav') || document.querySelector('.MuiDrawer-paper');

        let isLargeOverlayActive = false;
        const overlays = document.querySelectorAll('.MuiDialog-paper, .MuiDrawer-paper, [role="dialog"]');
        
        overlays.forEach(overlay => {
            const rect = overlay.getBoundingClientRect();
            if (rect.left < 100 && rect.width < 350) return; 
            
            const style = window.getComputedStyle(overlay);
            const isOnScreen = rect.right > 0 && rect.left < window.innerWidth;
            const isRendered = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            
            if (rect.width > 600 && isRendered && isOnScreen) {
                isLargeOverlayActive = true;
            }
        });

        if (quickMenu) {
            if (isDashboard || isDocumentView || isPartsPopup || !hasSidebar || isLargeOverlayActive || appSettings.showSidebar === false) {
                quickMenu.style.display = 'none';
            } else {
                quickMenu.style.display = 'flex';
            }
        }
    } catch (e) {
        console.warn("Enhancement error:", e);
    }
};

function isOurNode(node) {
    if (!node || node.nodeType !== 1) return false;
    const id = node.id || '';
    const className = typeof node.className === 'string' ? node.className : '';
    return id.indexOf('leaside-') === 0 || id === 'shop-logo-fixed' || className.indexOf('leaside-') !== -1;
}

const observer = new MutationObserver((mutations) => {
    const onlyOurChanges = mutations.every((mutation) => {
        if (isOurNode(mutation.target)) return true;
        return Array.from(mutation.addedNodes || []).every(isOurNode) && Array.from(mutation.removedNodes || []).every(isOurNode);
    });
    if (onlyOurChanges) return;
    clearTimeout(domTimer);
    domTimer = setTimeout(runEnhancements, 150);
});

window.addEventListener("DOMContentLoaded", () => {
    runEnhancements();
    observer.observe(document.body, { childList: true, subtree: true });
    
    const href = window.location.href;
    
    if (!isHiddenPrinter && href.includes('/document/') && (href.includes('/estimate') || href.includes('/repair') || href.includes('/invoice') || href.includes('/inspections'))) {
        if (window.top === window) {
            ipcRenderer.send('document-ready', href, false);
        }
    }
});

document.addEventListener('focusout', (event) => {
    if (!appSettings.autoCaps) return;
    const el = event.target;
    if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'search'))) {
        if (el.type === 'password' || (el.name || "").toLowerCase().includes('email')) return;
        
        if (el.getAttribute('role') === 'combobox' || el.hasAttribute('aria-haspopup') || el.hasAttribute('aria-autocomplete')) {
            return;
        }

        if (window.location.href.toLowerCase().includes('partstech')) {
            return;
        }

        setTimeout(() => {
            if (!el.value) return;
            const upper = el.value.toUpperCase();
            if (el.value !== upper) {
                forceNativeInput(el, upper, true);
            }
        }, 150);
    }
}, { capture: true });

ipcRenderer.on('fill-login', (event, creds) => {
    const email = document.querySelector('input[name="email"]');
    const pass = document.querySelector('input[name="password"]');
    if (email && pass) {
        forceNativeInput(email, creds.email);
        forceNativeInput(pass, creds.pass);
        setTimeout(() => document.querySelector('button[type="submit"]')?.click(), 500);
    }
});

function getShopData() {
    let customer = "";
    let vehicle = "";
    let phone = "";
    
    try {
        const custEl = document.querySelector('[data-testid="customer-name"]') || document.querySelector('.MuiTypography-h4');
        if (custEl) customer = custEl.textContent.trim();
        
        const vehEl = document.querySelector('[data-testid="vehicle-info"]') || document.querySelector('.MuiTypography-subtitle1') || document.querySelector('h6');
        if (vehEl) vehicle = vehEl.textContent.trim();
        
        const phoneEl = Array.from(document.querySelectorAll('a[href^="tel:"]')).find(el => el.textContent.trim().length > 0);
        if (phoneEl) phone = phoneEl.textContent.trim();
    } catch(e) {}
    
    return { customer, vehicle, phone };
}

const originalWindowOpen = window.open;
window.open = function(url, name, features) {
    if (typeof url === 'string' && (url.startsWith('blob:') || url.includes('/print') || url.includes('.pdf'))) {
        fetch(url)
            .then(res => res.arrayBuffer())
            .then(buffer => {
                const uint8Array = new Uint8Array(buffer);
                const shopData = getShopData();
                ipcRenderer.send('modify-pdf-blob', uint8Array, shopData);
            })
            .catch(err => console.error("Blob error:", err));
        
        return { close: () => {}, focus: () => {}, print: () => {}, document: { write: () => {}, close: () => {} } };
    }
    
    return originalWindowOpen.apply(this, arguments);
};