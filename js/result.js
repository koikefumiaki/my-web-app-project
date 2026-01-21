// =====================================================================
// 愛知マイ備蓄ナビ - RESULT画面ロジック (result.js)
// 役割: 全ての機能を正常に動作させ、AI提案を統合する
// =====================================================================

// 1. 定数とグローバル変数の定義
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

// 2. データの読み込み処理
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
            return (isNaN(latNum) || iNaN(lngNum)) ? null : {
                name: s.name, lat: latNum, lng: lngNum, address: s.address || '住所情報なし'
            };
        }).filter(s => s !== null);
        return true;
    } catch (error) {
        console.error("データロード失敗:", error);
        return false;
    }
}

// 3. 初期化処理 (全ての機能を順番に呼び出す)
function initResult() {
    const params = new URLSearchParams(window.location.search);
    const selectedCity = params.get('city');
    const familySize = parseInt(params.get('size'), 10);
    const durationDays = parseInt(params.get('days'), 10);
    const address = params.get('addr');
    
    inputParams = { city: selectedCity, size: familySize, days: durationDays, addr: address };
    
    if (!selectedCity || !familySize || !durationDays || !address) {
        alert("入力情報が足りません。ホームに戻ります。");
        window.location.href = 'index.html';
        return;
    }

    // 基本情報の表示
    document.getElementById('target-full-address').textContent = `愛知県 ${selectedCity} ${address}`;
    document.getElementById('summary-family-size').textContent = familySize;
    document.getElementById('summary-duration-days').textContent = durationDays;

    loadAllData().then(dataLoaded => {
        if (dataLoaded) {
            // --- 元の機能を実行 ---
            calculateAndDisplaySupply(familySize, durationDays); // 備蓄リスト表示
            displayGeneralNecessities();                        // 必需品リスト表示
            displayHazardInfoOnly(selectedCity);                 // ハザード情報表示
            
            // --- AI機能を実行 ---
            prepareAISection(selectedCity, familySize, durationDays);

            // --- 地図機能を実行 ---
            const fullAddress = `愛知県${selectedCity}${address}`;
            loadGoogleMapsAPI(fullAddress); 
            
            // ボタンのイベント設定
            const showBtn = document.getElementById('show-map-button');
            const closeBtn = document.getElementById('close-shelter-button');
            if (showBtn) showBtn.addEventListener('click', handleMapDisplay); 
            if (closeBtn) closeBtn.addEventListener('click', closeShelterMap);
        }
    });
}

// 4. AI提案 (Gemini) ロジック
function prepareAISection(city, size, days) {
    const titleEl = document.getElementById('ai-title');
    if (titleEl) {
        titleEl.textContent = `✨ AIによる${city}限定・特別備蓄メニュー`;
    }

    const aiArea = document.getElementById('ai-proposal-area');
    if (aiArea) {
        fetchAIGeminiProposal(size, days, city, aiArea);
    }
}

async function fetchAIGeminiProposal(size, days, city, displayElement) {
    if (!GEMINI_API_KEY) return;
    const prompt = `あなたは愛知県の防災専門家です。愛知県${city}に住む${size}人家族が、災害時に${days}日間生き延びるための、愛知の食文化を取り入れた具体的な備蓄メニューを提案してください。回答はHTMLの<ul><li>タグのみを使用してください。`;

    try {
        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await response.json();
        if (data.candidates) {
            displayElement.innerHTML = data.candidates[0].content.parts[0].text;
        }
    } catch (e) {
        displayElement.innerHTML = "<p>AI提案の取得に失敗しました。</p>";
    }
}

// 5. 既存の備蓄計算ロジック (supply_data.jsonを使用)
function calculateAndDisplaySupply(familySize, durationDays) {
    const standards = appData.supply.unit_standards;
    const container = document.getElementById('detailed-supply-list');
    if (!container || !standards) return;

    let htmlContent = '';
    standards.forEach(item => {
        const totalAmount = item.amount_per_person_day * durationDays * familySize;
        htmlContent += `<div class="bichiku-category" style="margin-bottom:20px;">
            <h4 style="border-bottom: 2px solid #007bff; padding-bottom:5px;">${item.item_jp} (総量目安: ${totalAmount}${item.unit})</h4><ul>`;
        if (item.breakdown_items) {
            item.breakdown_items.forEach(bi => {
                let count = (item.item_en === 'water') 
                    ? Math.ceil(totalAmount * bi.allocation_ratio / bi.volume_l) 
                    : bi.amount_per_person_day * durationDays * familySize;
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
    if (!container || !necessities) return;

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
    if (hazardData && maxShindoEl && tsunamiStatusEl) {
        maxShindoEl.textContent = hazardData.max_shindo || '--';
        tsunamiStatusEl.textContent = (hazardData.max_tsunami_height_m > 0) ? `${hazardData.max_tsunami_height_m}m` : '心配ありません';
    }
}

// 6. Google Maps 関連
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
    if (window.fullAddressForMap) geocodeAndDisplayShelter(window.fullAddressForMap);
}

function geocodeAndDisplayShelter(addr) {
    if (!geocoder) return;
    geocoder.geocode({ 'address': addr }, (results, status) => {
        if (status === 'OK' && results[0]) findAndDisplayNearestShelter(results[0].geometry.location);
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