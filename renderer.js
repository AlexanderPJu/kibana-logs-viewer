let currentData = [];
let currentHeaders = [];
let highlightRules = JSON.parse(localStorage.getItem('highlightRules')) || []; 

function formatForDateTimeLocal(date) {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
}

function setDefaultDates() {
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    document.getElementById('date-to').value = formatForDateTimeLocal(now);
    document.getElementById('date-from').value = formatForDateTimeLocal(oneWeekAgo);
}

window.clearDate = function(id) { document.getElementById(id).value = ''; renderTable(); }
window.clearSearch = function() { document.getElementById('search-input').value = ''; renderTable(); }

renderChips();
setDefaultDates();

document.getElementById('open-file-btn').addEventListener('click', async () => {
    const csvContent = await window.electronAPI.openFile();
    if (csvContent) {
        document.getElementById('search-input').value = '';
        Papa.parse(csvContent, {
            header: true, skipEmptyLines: true,
            complete: (results) => {
                currentData = results.data;
                currentHeaders = results.meta.fields;
                renderTable();
            }
        });
    }
});

document.getElementById('search-input').addEventListener('input', renderTable);
document.getElementById('date-from').addEventListener('input', renderTable);
document.getElementById('date-to').addEventListener('input', renderTable);

document.getElementById('add-keyword-btn').addEventListener('click', addKeyword);
document.getElementById('keyword-input').addEventListener('keypress', (e) => { if (e.key === 'Enter') addKeyword(); });

function saveRules() { localStorage.setItem('highlightRules', JSON.stringify(highlightRules)); }

function addKeyword() {
    const input = document.getElementById('keyword-input');
    const colorPicker = document.getElementById('keyword-color');
    const word = input.value.trim();
    if (!word) return;

    highlightRules.push({ word: word, color: colorPicker.value, bgColor: colorPicker.value + '33', enabled: true });
    input.value = '';
    saveRules(); renderChips(); renderTable(); 
}

window.removeKeyword = function(index) { highlightRules.splice(index, 1); saveRules(); renderChips(); renderTable(); }
window.toggleKeyword = function(index, isChecked) { highlightRules[index].enabled = isChecked; saveRules(); renderChips(); renderTable(); }
window.changeKeywordColor = function(index, newColor) { highlightRules[index].color = newColor; highlightRules[index].bgColor = newColor + '33'; saveRules(); renderChips(); renderTable(); }

function renderChips() {
    const container = document.getElementById('active-keywords-container');
    if (highlightRules.length === 0) {
        container.innerHTML = '<span style="color: #666; font-style: italic; font-size: 13px;">Добавьте ключевые слова для подсветки...</span>';
        return;
    }
    container.innerHTML = highlightRules.map((rule, index) => {
        const isEnabled = rule.enabled !== false;
        return `
        <div class="keyword-chip" style="color: ${rule.color}; border-color: ${rule.color}; background: ${rule.bgColor}; opacity: ${isEnabled ? 1 : 0.4}">
            <input type="checkbox" ${isEnabled ? 'checked' : ''} onchange="toggleKeyword(${index}, this.checked)" title="Вкл/Выкл подсветку">
            ${escapeHtml(rule.word)}
            <input type="color" value="${rule.color}" onchange="changeKeywordColor(${index}, this.value)" title="Изменить цвет">
            <span onclick="removeKeyword(${index})" title="Удалить">✖</span>
        </div>`
    }).join('');
}

function getCleanValue(rawValue) {
    if (!rawValue) return '';
    let text = rawValue.toString();
    text = text.replace(/\\+(?=[\"\{\}\[\]\:\,])/g, '');
    text = text.replace(/\\\\/g, '\\');
    return text.trim();
}

function parseLogDate(dateStr) {
    if (!dateStr) return null;
    const parsed = Date.parse(dateStr);
    return isNaN(parsed) ? null : new Date(parsed);
}

// --- УТИЛИТЫ ФОРМАТИРОВАНИЯ И ПОДСВЕТКИ ---
function escapeHtml(text) {
    if (!text) return '';
    return text.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatAndHighlight(text) {
    let htmlText = escapeHtml(text);
    
    // Мгновенная и безопасная подсветка чипсов
    highlightRules.forEach(rule => {
        if (rule.enabled === false) return; 
        const safeWord = escapeRegExp(rule.word);
        const regex = new RegExp(`(${safeWord})`, 'gi');
        htmlText = htmlText.replace(regex, `<span style="background-color: ${rule.bgColor}; color: ${rule.color}; padding: 1px 3px; border-radius: 3px; font-weight: bold;">$1</span>`);
    });

    return htmlText;
}

// --- Отрисовка таблицы ---
function renderTable() {
    const tableContainer = document.getElementById('table-container');
    if (!currentData.length) return;

    const searchQuery = document.getElementById('search-input').value.toLowerCase().trim();
    const dateFromVal = document.getElementById('date-from').value;
    const dateToVal = document.getElementById('date-to').value;
    const filterDateFrom = dateFromVal ? new Date(dateFromVal) : null;
    const filterDateTo = dateToVal ? new Date(dateToVal) : null;

    const filteredData = currentData.filter(row => {
        if (searchQuery) {
            const rowText = Object.values(row).join(' ').toLowerCase();
            if (!rowText.includes(searchQuery)) return false;
        }

        if (filterDateFrom || filterDateTo) {
            const dateHeader = currentHeaders.find(header => {
                const lower = header.toLowerCase();
                return lower.includes('time') || lower.includes('date') || lower.includes('@timestamp');
            });
            if (dateHeader) {
                const logDate = parseLogDate(row[dateHeader]);
                if (logDate) {
                    if (filterDateFrom && logDate < filterDateFrom) return false;
                    if (filterDateTo && logDate > filterDateTo) return false;
                }
            }
        }
        return true;
    });

    if (filteredData.length === 0) {
        tableContainer.innerHTML = '<div style="padding: 40px; font-style: italic; color: #888; text-align: center;">Ничего не найдено...</div>';
        return;
    }

    let table = '<table id="log-table"><colgroup>';
    currentHeaders.forEach(header => {
        const lowerHeader = header.toLowerCase();
        if (lowerHeader.includes('time') || lowerHeader.includes('@timestamp') || lowerHeader.includes('date')) {
            table += '<col style="width: 140px;">';
        } else if (lowerHeader.includes('level') || lowerHeader.includes('log.level') || lowerHeader.includes('status')) {
            table += '<col style="width: 100px;">';
        } else {
            table += '<col>';
        }
    });
    table += '</colgroup><thead><tr>';
    
    currentHeaders.forEach(header => {
        table += `<th>${header === '_source' ? 'message' : header}</th>`;
    });
    table += '</tr></thead><tbody>';

    filteredData.forEach((row) => {
        table += '<tr>';
        currentHeaders.forEach(header => {
            const isMessageCol = header === '_source' || header === 'message';
            let rawValue = row[header] || '';
            if (isMessageCol) rawValue = getCleanValue(rawValue);
            
            table += `<td>${formatAndHighlight(rawValue)}</td>`;
        });
        table += '</tr>';
    });
    
    table += '</tbody></table>';
    tableContainer.innerHTML = table;
}
