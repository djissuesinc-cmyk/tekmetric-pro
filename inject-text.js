// v2.5.2: format Quick Actions preset inserts (one job per line in textareas).
// Split on top-level ',' and '+' only — commas/pluses inside (parentheses) stay in the same part.

function splitPresetParts(text) {
    const parts = [];
    let buf = '';
    let depth = 0;
    const s = String(text == null ? '' : text);
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '(') {
            depth++;
            buf += ch;
        } else if (ch === ')') {
            if (depth > 0) depth--;
            buf += ch;
        } else if (depth === 0 && (ch === ',' || ch === '+')) {
            const t = buf.trim();
            if (t) parts.push(t);
            buf = '';
        } else {
            buf += ch;
        }
    }
    const t = buf.trim();
    if (t) parts.push(t);
    return parts;
}

function stripTrailingSeps(value) {
    return String(value == null ? '' : value).replace(/[\s+,]+$/, '');
}

// multiline (textarea): each part on its own line as "+ PART".
// single-line <input>: keep the old " + " joining so the field stays one line.
function nextInjectValue(currentVal, textToInsert, multiline) {
    if (multiline) {
        const parts = splitPresetParts(textToInsert);
        if (!parts.length) return stripTrailingSeps(currentVal);
        const block = parts.map(p => '+ ' + p).join('\n');
        const cur = stripTrailingSeps(currentVal);
        return cur ? (cur + '\n' + block) : block;
    }
    let cur = String(currentVal == null ? '' : currentVal).trim();
    if (cur !== '' && !cur.endsWith('+') && !cur.endsWith(',')) {
        cur += ' + ';
    } else if (cur !== '') {
        cur += ' ';
    }
    return cur + textToInsert + ' + ';
}

module.exports = { splitPresetParts, stripTrailingSeps, nextInjectValue };
