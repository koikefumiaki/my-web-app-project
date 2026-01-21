// =====================================================================
// 愛知マイ備蓄ナビ - RESULT画面ロジック (result.js)
// GitHub Pages 対応版 (相対パス修正)
// =====================================================================

// CONFIGが読み込めなかった場合の安全策
const API_KEY = (typeof CONFIG !== 'undefined') ? CONFIG.GOOGLE_MAPS_API_KEY : ""; 
const GEMINI_API_KEY = (typeof CONFIG !== 'undefined') ? CONFIG.GEMINI_API_KEY : ""; 
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

// パスを相対パス（./data/...）に変更
const DATA_PATHS = {
    CITIES: './data/aichi_cities.json', 
    HAZARD: './data/hazard_data.json',   
    SUPPLY: './data/supply_data.json',   
    SHELTER: './data/shelter_list.json'  
};

let appData = {};
let map, geocoder; 
let googleMapsLoaded = false; 
let inputParams = {};
let nearestShelterData = null; 

async function loadAllData() {
    console.log("データの読み込みを開始します...");
    const loadPromises = [
        fetch(DATA_PATHS.CITIES).then(res => res.ok ? res.json() : []), 
        fetch(DATA_PATHS.HAZARD).then(res => res.ok ? res.json() : []),
        fetch(DATA_PATHS.SUPPLY).then(res => res.ok ? res.json() : {unit_standards: [], general_necessities: []}),
        fetch(DATA_PATHS.SHELTER).then(res => res.ok ? res.json() : [])
    ];

    try {
        const [cities, hazard, supply, shelterRaw] = await Promise.all(loadPromises);
        appData.cities = cities;
        appData.hazard = hazard;
        appData.supply = supply;
        
        appData.shelter = (shelterRaw || []).map(s => {
            const latNum = parseFloat(s.latitude);
            const lngNum = parseFloat(s.longitude);
            return (isNaN(latNum) || isNaN(lngNum)) ? null : {
                name: s.name, lat: latNum, lng: lngNum, address: s.address || '住所情報なし'
            };
        }).filter(s => s !== null);
        
        console.log("データの読み込みに成功しました");
        return true;
    } catch (error) {
        console.error("データ読み込みエラー:", error);
        return false;
    }
}

function initResult() {
    const params = new URLSearchParams(window.location.search);
    const selectedCity = params.get('city');
    const familySize = parseInt(params.get('size'), 10);
    const durationDays = parseInt(params.get('days'), 10);
    const address = params.get('addr');
    
    inputParams = { city: selectedCity, size: familySize, days: durationDays, addr: address };
    
    if (!selectedCity || !familySize || !durationDays || !address) {
        alert("必要な入力情報がありません。ホーム画面に戻ります。");
        window.location.href = 'index.html';
        return;
    }

    document.getElementById('target-full-address').textContent = `愛知県 ${selectedCity} ${address}`;
    document.getElementById('summary-family-size').textContent = familySize;
    document.getElementById('summary-duration-days').textContent = durationDays;

    loadAllData().then(dataLoaded => {
        if (dataLoaded) {
            calculateAndDisplaySupply(familySize, durationDays); 
            displayGeneralNecessities();                        
            displayHazardInfoOnly(selectedCity);                 
            prepareAISection(selectedCity, familySize, durationDays);

            const fullAddress = `愛知県${selectedCity}${address}`;
            loadGoogleMapsAPI(fullAddress); 
            
            const showBtn = document.getElementById('show-map-button');
            const closeBtn = document.getElementById('close-shelter-button');
            if (showBtn) showBtn.addEventListener('click', handleMapDisplay); 
            if (closeBtn) closeBtn.addEventListener('click', closeShelterMap);
        } else {
            alert("データの読み込みに失敗しました。パス設定を確認してください。");
        }
    });
}

function prepareAISection(city, size, days) {
    const titleEl = document.getElementById('ai-title');
    if (titleEl) titleEl.textContent = `✨ AIによる${city}限定・特別備蓄メニュー`;
    const aiArea = document.getElementById('ai-proposal-area');
    if (aiArea) fetchAIGeminiProposal(size, days, city, aiArea);
}

async function fetchAIGeminiProposal(size, days, city, displayElement) {
    if (!GEMINI_API_KEY) {
        displayElement.innerHTML = "<p>APIキーが正しく読み込めていません。</p>";
        return;
    }
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
    const hazardData = (appData.hazard || []).find(d => d.city_name_jp === selectedCity); 
    const maxShindoEl = document.getElementById('max-shindo');
    const tsunamiStatusEl = document.getElementById('tsunami-height-status');
    if (hazardData && maxShindoEl && tsunamiStatusEl) {
        maxShindoEl.textContent = hazardData.max_shindo || '--';
        tsunamiStatusEl.textContent = (hazardData.max_tsunami_height_m > 0) ? `${hazardData.max_tsunami_height_m}m` : '心配ありません';
    }
}

function loadGoogleMapsAPI(fullAddress) {
    if (googleMapsLoaded) { geocodeAndDisplayShelter(fullAddress); return; }
    if (!API_KEY) return;
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
    if (appData.shelter && google.maps.geometry) {
        appData.shelter.forEach(s => {
            const d = google.maps.geometry.spherical.computeDistanceBetween(center, new google.maps.LatLng(s.lat, s.lng));
            if (d < minD) { minD = d; nearest = s; }
        });
    }
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