let currentData = [];
let currentHeaders = [];
// --- Загружаем чипсы из локальной памяти при старте ---
let highlightRules = JSON.parse(localStorage.getItem('highlightRules')) || []; 
let jsonToggledRows = new Set(); // Храним индексы строк, где включен JSON

// Отрисовываем чипсы сразу при запуске программы (до загрузки файла)
renderChips();

// --- Загрузка файла ---
document.getElementById('open-file-btn').addEventListener('click', async () => {
    const statusDiv = document.getElementById('status');
    const tableContainer = document.getElementById('table-container');

    statusDiv.textContent = 'Загрузка...';
    const csvContent = await window.electronAPI.openFile();

    if (csvContent) {
        jsonToggledRows.clear(); // Сбрасываем состояния чекбоксов при открытии нового файла
        Papa.parse(csvContent, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                currentData = results.data;
                currentHeaders = results.meta.fields;
                statusDiv.textContent = `Загружено строк: ${currentData.length}`;
                renderTable();
            }
        });
    } else {
        statusDiv.textContent = 'Отменено.';
    }
});

// --- Управление ключевыми словами ---
document.getElementById('add-keyword-btn').addEventListener('click', addKeyword);
document.getElementById('keyword-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addKeyword();
});

// Функция для сохранения правил в память
function saveRules() {
    localStorage.setItem('highlightRules', JSON.stringify(highlightRules));
}

function addKeyword() {
    const input = document.getElementById('keyword-input');
    const colorPicker = document.getElementById('keyword-color');
    const word = input.value.trim();
    
    if (!word) return;

    highlightRules.push({ 
        word: word, 
        color: colorPicker.value,
        bgColor: colorPicker.value + '33',
        enabled: true // По умолчанию новое слово включено
    });

    input.value = '';
    saveRules();
    renderChips();
    renderTable(); 
}

// Делаем функции глобальными, чтобы они работали из inline HTML
window.removeKeyword = function(index) {
    highlightRules.splice(index, 1);
    saveRules();
    renderChips();
    renderTable();
}

window.toggleKeyword = function(index, isChecked) {
    highlightRules[index].enabled = isChecked;
    saveRules();
    renderChips(); // Обновляем прозрачность чипса
    renderTable(); // Обновляем таблицу
}

window.changeKeywordColor = function(index, newColor) {
    highlightRules[index].color = newColor;
    highlightRules[index].bgColor = newColor + '33';
    saveRules();
    renderChips();
    renderTable();
}

function renderChips() {
    const container = document.getElementById('active-keywords');
    container.innerHTML = highlightRules.map((rule, index) => {
        const isEnabled = rule.enabled !== false; // Защита для старых сохраненных правил без этого поля
        return `
        <div class="keyword-chip" style="color: ${rule.color}; border-color: ${rule.color}; background: ${rule.bgColor}; opacity: ${isEnabled ? 1 : 0.4}">
            <input type="checkbox" ${isEnabled ? 'checked' : ''} onchange="toggleKeyword(${index}, this.checked)" title="Вкл/Выкл подсветку">
            ${escapeHtml(rule.word)}
            <input type="color" value="${rule.color}" onchange="changeKeywordColor(${index}, this.value)" title="Изменить цвет">
            <span onclick="removeKeyword(${index})" title="Удалить">✖</span>
        </div>
    `}).join('');
}

// --- Обработчик для чекбоксов JSON (Делегирование событий) ---
document.addEventListener('change', (e) => {
    if (e.target && e.target.classList.contains('json-toggle')) {
        const rowIndex = parseInt(e.target.getAttribute('data-row'));
        const header = e.target.getAttribute('data-header');
        
        if (e.target.checked) {
            jsonToggledRows.add(rowIndex);
        } else {
            jsonToggledRows.delete(rowIndex);
        }
        // Перерисовываем только конкретную ячейку, чтобы не сбивать прокрутку
        updateCellContent(rowIndex, header);
    }
});

// Очистка слешей от Кибаны
function getCleanValue(rawValue) {
    if (!rawValue) return '';
    let text = rawValue.toString();
    text = text.replace(/\\+(?=[\"\{\}\[\]\:\,])/g, '');
    text = text.replace(/\\\\/g, '\\');
    return text.trim();
}

// Умное извлечение и форматирование JSON внутри текста
function extractAndFormatJSON(text) {
    try {
        return JSON.stringify(JSON.parse(text), null, 2);
    } catch (e) {}

    const firstCurly = text.indexOf('{');
    const lastCurly = text.lastIndexOf('}');
    
    if (firstCurly !== -1 && lastCurly !== -1 && firstCurly < lastCurly) {
        const prefix = text.substring(0, firstCurly);
        const possibleJson = text.substring(firstCurly, lastCurly + 1);
        const suffix = text.substring(lastCurly + 1);

        try {
            const parsed = JSON.parse(possibleJson);
            return prefix + '\n' + JSON.stringify(parsed, null, 2) + '\n' + suffix;
        } catch (e) {}
    }

    const firstSquare = text.indexOf('[');
    const lastSquare = text.lastIndexOf(']');
    
    if (firstSquare !== -1 && lastSquare !== -1 && firstSquare < lastSquare) {
        const prefix = text.substring(0, firstSquare);
        const possibleJson = text.substring(firstSquare, lastSquare + 1);
        const suffix = text.substring(lastSquare + 1);

        try {
            const parsed = JSON.parse(possibleJson);
            return prefix + '\n' + JSON.stringify(parsed, null, 2) + '\n' + suffix;
        } catch (e) {}
    }

    return text;
}

function updateCellContent(rowIndex, header) {
    const contentDiv = document.getElementById(`content-${rowIndex}`);
    if (!contentDiv) return;

    let rawValue = currentData[rowIndex][header] || '';
    let cleanValue = getCleanValue(rawValue);

    if (jsonToggledRows.has(rowIndex)) {
        cleanValue = extractAndFormatJSON(cleanValue);
    }
    
    contentDiv.innerHTML = formatAndHighlight(cleanValue);
}

// --- Отрисовка таблицы с умным распределением ширины колонок ---
function renderTable() {
    const tableContainer = document.getElementById('table-container');
    if (!currentData.length) return;

    let table = '<table id="log-table">';
    
    table += '<colgroup>';
    currentHeaders.forEach(header => {
        const lowerHeader = header.toLowerCase();
        
        if (lowerHeader.includes('time') || lowerHeader.includes('@timestamp') || lowerHeader.includes('date')) {
            table += '<col style="width: 180px;">';
        } else if (lowerHeader.includes('level') || lowerHeader.includes('log.level') || lowerHeader.includes('status')) {
            table += '<col style="width: 100px;">';
        } else {
            table += '<col>';
        }
    });
    table += '</colgroup>';

    // Заголовки таблицы
    table += '<thead><tr>';
    currentHeaders.forEach(header => {
        const displayHeader = header === '_source' ? 'message' : header;
        table += `<th>${displayHeader}</th>`;
    });
    table += '</tr></thead><tbody>';

    // Строки таблицы
    currentData.forEach((row, rowIndex) => {
        table += '<tr>';
        currentHeaders.forEach(header => {
            const isMessageCol = header === '_source' || header === 'message';
            let rawValue = row[header] || '';
            let contentHtml = '';

            if (isMessageCol) {
                let cleanValue = getCleanValue(rawValue);
                let isJsonChecked = jsonToggledRows.has(rowIndex);
                
                if (isJsonChecked) {
                    cleanValue = extractAndFormatJSON(cleanValue);
                }

                // Сверхкомпактный чекбокс в одну строку HTML
                contentHtml = `<div style="margin:0;padding:0;line-height:1;display:block;"><label style="font-size:11px;color:#888;cursor:pointer;user-select:none;display:inline-flex;align-items:center;gap:4px;margin:0;padding:0;line-height:1;"><input type="checkbox" class="json-toggle" data-row="${rowIndex}" data-header="${header}" ${isJsonChecked ? 'checked' : ''} style="margin:0;padding:0;width:12px;height:12px;vertical-align:middle;">Форматировать JSON</label></div><div id="content-${rowIndex}" style="margin-top:4px;">${formatAndHighlight(cleanValue)}</div>`;
            } else {
                contentHtml = formatAndHighlight(rawValue);
            }

            table += `<td>${contentHtml}</td>`;
        });
        table += '</tr>';
    });
    
    table += '</tbody></table>';
    tableContainer.innerHTML = table;
}

// --- Утилиты ---
function escapeHtml(text) {
    if (!text) return '';
    return text.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatAndHighlight(text) {
    let htmlText = escapeHtml(text);
    
    highlightRules.forEach(rule => {
        // Пропускаем выключенные правила!
        if (rule.enabled === false) return; 

        const safeWord = escapeRegExp(rule.word);
        const regex = new RegExp(`(${safeWord})`, 'gi');
        htmlText = htmlText.replace(regex, `<span style="background-color: ${rule.bgColor}; color: ${rule.color}; padding: 2px 4px; border-radius: 3px; font-weight: bold;">$1</span>`);
    });

    return htmlText;
}
