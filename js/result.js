// =====================================================================
// 愛知マイ備蓄ナビ - RESULT画面ロジック (result.js)
// =====================================================================

// ----------------------------------------------------
// 1. 定数とグローバル変数の定義
// ----------------------------------------------------
const API_KEY = CONFIG.GOOGLE_MAPS_API_KEY; 
const GEMINI_API_KEY = CONFIG.GEMINI_API_KEY; 
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

const DATA_PATHS = {
    CITIES: '/my-web-app-project/data/aichi_cities.json', 
    HAZARD: '/my-web-app-project/data/hazard_data.json',   
    SUPPLY: '/my-web-app-project/data/supply_data.json',   
    SHELTER: '/my-web-app-project/data/shelter_list.json'  
};

let appData = {};
let map, geocoder; 
let googleMapsLoaded = false; 
let inputParams = {};
let nearestShelterData = null; 

// ----------------------------------------------------
// 2. データの読み込み処理
// ----------------------------------------------------
async function loadAllData() {
    const loadPromises = [
        fetch(DATA_PATHS.CITIES).then(res => res.json()).catch(() => []), 
        fetch(DATA_PATHS.HAZARD).then(res => res.json()).catch(() => []),
        fetch(DATA_PATHS.SUPPLY).then(res => res.json()).catch(() => ({unit_standards: [], general_necessities: []})),
        fetch(DATA_PATHS.SHELTER).then(res => res.json()).catch(() => [])
    ];

    try {
        const [cities, hazard, supply, shelterRaw] = await Promise.all(loadPromises);
        appData.cities = cities;
        appData.hazard = hazard;
        appData.supply = supply;
        appData.shelter = shelterRaw.map(s => {
            const latNum = parseFloat(s.latitude);
            const lngNum = parseFloat(s.longitude);
            return (isNaN(latNum) || isNaN(lngNum)) ? null : {
                name: s.name, lat: latNum, lng: lngNum, address: s.address || '住所情報なし'
            };
        }).filter(s => s !== null);
        return true;
    } catch (error) {
        return false;
    }
}

// ----------------------------------------------------
// 3. 初期化処理
// ----------------------------------------------------
function initResult() {
    const params = new URLSearchParams(window.location.search);
    const selectedCity = params.get('city');
    const familySize = parseInt(params.get('size'), 10);
    const durationDays = parseInt(params.get('days'), 10);
    const address = params.get('addr');
    
    inputParams = { city: selectedCity, size: familySize, days: durationDays, addr: address };
    
    if (!selectedCity || !familySize || !durationDays || !address) {
        alert("必要な入力情報がありません。");
        window.location.href = 'index.html';
        return;
    }

    document.getElementById('target-full-address').textContent = `愛知県 ${selectedCity} ${address}`;
    document.getElementById('summary-family-size').textContent = familySize;
    document.getElementById('summary-duration-days').textContent = durationDays;

    loadAllData().then(dataLoaded => {
        if (dataLoaded) {
            // ① 既存の備蓄計算結果を表示
            calculateAndDisplaySupply(familySize, durationDays);
            displayGeneralNecessities();
            displayHazardInfoOnly(selectedCity); 
            
            // ② AI提案エリアを「動的に」追加（テンプレートリテラルを修正）
            prepareAISection(selectedCity, familySize, durationDays);

            // ③ Google Maps 連携
            const fullAddress = `愛知県${inputParams.city}${inputParams.addr}`;
            loadGoogleMapsAPI(fullAddress); 
            
            document.getElementById('show-map-button').addEventListener('click', handleMapDisplay); 
            document.getElementById('close-shelter-button').addEventListener('click', closeShelterMap);
        }
    });
}

// ----------------------------------------------------
// 4. AI提案 (Gemini API) 連携
// ----------------------------------------------------
function prepareAISection(city, size, days) {
    const container = document.getElementById('detailed-supply-list');
    if (!container) return;

    const aiDiv = document.createElement('div');
    aiDiv.className = 'ai-box-container';
    aiDiv.style = "margin-top: 20px; padding: 15px; background-color: #f0f7ff; border: 1px solid #cce3ff; border-radius: 10px;";
    
    // 変数を正しく埋め込むためにバッククォートを使用
    aiDiv.innerHTML = `
        <h4 style="color: #0056b3; margin-bottom: 10px;">✨ AIによる${city}限定・特別備蓄メニュー</h4>
        <div id="ai-proposal-area">
            <p style="color: #666; font-style: italic;">AIがあなたの家族構成に合わせたメニューを考えています...</p>
        </div>
    `;
    
    // 計算結果リストの「後ろ」に追加
    container.after(aiDiv);
    
    fetchAIGeminiProposal(size, days, city, document.getElementById('ai-proposal-area'));
}

async function fetchAIGeminiProposal(size, days, city, displayElement) {
    if (typeof CONFIG === 'undefined' || !CONFIG.GEMINI_API_KEY) {
        displayElement.innerHTML = "<p>APIキーが設定されていません。</p>";
        return;
    }

    const prompt = `あなたは愛知県の防災専門家です。愛知県${city}に住む${size}人家族が、災害時に${days}日間生き延びるための、愛知の食文化（赤味噌等）を取り入れた具体的な備蓄活用メニューを提案してください。回答はHTMLの<ul><li>タグのみを使用してください。`;

    try {
        const response = await fetch(`${GEMINI_API_URL}?key=${CONFIG.GEMINI_API_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await response.json();
        const aiText = data.candidates[0].content.parts[0].text;
        displayElement.innerHTML = aiText;
    } catch (e) {
        displayElement.innerHTML = "<p>AI提案の取得に失敗しました。</p>";
    }
}

// ----------------------------------------------------
// 5. 既存機能（変更なし）
// ----------------------------------------------------
function calculateAndDisplaySupply(familySize, durationDays) {
    const standards = appData.supply.unit_standards;
    const container = document.getElementById('detailed-supply-list');
    let htmlContent = '';

    standards.forEach(item => {
        const totalBaseAmount = item.amount_per_person_day * durationDays * familySize;
        htmlContent += `<div class="bichiku-category" style="margin-bottom:20px;">
            <h4 style="border-bottom: 1px solid #eee;">${item.item_jp} (目安: ${totalBaseAmount}${item.unit})</h4><ul>`;
        if (item.breakdown_items) {
            item.breakdown_items.forEach(bi => {
                let count = item.item_en === 'water' ? Math.ceil(totalBaseAmount * bi.allocation_ratio / bi.volume_l) : bi.amount_per_person_day * durationDays * familySize;
                htmlContent += `<li><strong>${bi.item_name_jp}</strong>: ${count}${item.item_en === 'water' ? '本' : '個'}</li>`;
            });
        }
        htmlContent += `</ul></div>`;
    });
    container.innerHTML = htmlContent;
}

function displayGeneralNecessities() {
    const necessities = appData.supply.general_necessities;
    const container = document.getElementById('general-necessities-list');
    let htmlContent = '';
    necessities.forEach(item => {
        htmlContent += `<li><strong>${item.item_jp}</strong>: ${item.unit_count}</li>`;
    });
    container.innerHTML = htmlContent;
}

function displayHazardInfoOnly(selectedCity) {
    const hazardData = appData.hazard.find(d => d.city_name_jp === selectedCity); 
    const maxShindoEl = document.getElementById('max-shindo');
    const tsunamiStatusEl = document.getElementById('tsunami-height-status');
    if (hazardData) {
        maxShindoEl.textContent = hazardData.max_shindo || '--';
        tsunamiStatusEl.textContent = hazardData.max_tsunami_height_m > 0 ? `${hazardData.max_tsunami_height_m}m` : '心配ありません';
    }
}

// --- Google Maps 関連 ---
function loadGoogleMapsAPI(fullAddress) {
    if (googleMapsLoaded) { geocodeAndDisplayShelter(fullAddress); return; }
    const script = document.createElement('script');
    window.fullAddressForMap = fullAddress; 
    script.src = `https://maps.googleapis.com/maps/api/js?key=${API_KEY}&libraries=geometry&callback=initMapAndSearch`; 
    script.async = true;
    document.head.appendChild(script);
}

window.initMapAndSearch = function() {
    googleMapsLoaded = true;
    geocoder = new google.maps.Geocoder();
    map = new google.maps.Map(document.getElementById('map'), { center: { lat: 35.18, lng: 136.9 }, zoom: 10 });
    geocodeAndDisplayShelter(window.fullAddressForMap);
}

function geocodeAndDisplayShelter(addr) {
    geocoder.geocode({ 'address': addr }, (results, status) => {
        if (status === 'OK') findAndDisplayNearestShelter(results[0].geometry.location);
    });
}

function findAndDisplayNearestShelter(center) {
    let nearest = null; let minD = Infinity;
    appData.shelter.forEach(s => {
        const d = google.maps.geometry.spherical.computeDistanceBetween(center, new google.maps.LatLng(s.lat, s.lng));
        if (d < minD) { minD = d; nearest = s; }
    });
    if (nearest) {
        nearestShelterData = { ...nearest, centerLatLng: center };
        document.getElementById('nearest-shelter-info-display').innerHTML = `最寄り: <strong>${nearest.name}</strong> (約 ${(minD/1000).toFixed(2)}km)`;
        document.getElementById('show-map-button').style.display = 'block';
    }
}

function handleMapDisplay() {
    document.getElementById('map-area').style.display = 'block';
    document.getElementById('show-map-button').style.display = 'none';
    document.getElementById('close-shelter-button').style.display = 'block';
    if (map && nearestShelterData) {
        google.maps.event.trigger(map, 'resize');
        map.setCenter(nearestShelterData.centerLatLng);
        new google.maps.Marker({ position: nearestShelterData.centerLatLng, map: map });
        new google.maps.Marker({ position: {lat: nearestShelterData.lat, lng: nearestShelterData.lng}, map: map });
    }
}

function closeShelterMap() {
    document.getElementById('map-area').style.display = 'none';
    document.getElementById('show-map-button').style.display = 'block';
    document.getElementById('close-shelter-button').style.display = 'none';
}

document.addEventListener('DOMContentLoaded', initResult);