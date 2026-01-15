// =====================================================================
// 愛知マイ備蓄ナビ - RESULT画面ロジック (result.js)
// 役割: 結果の表示、備蓄計算、AI提案生成、ハザード情報表示、避難所検索
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
    console.log("データの読み込みを開始...");
    
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
        
        appData.shelter = shelterRaw
            .map(s => {
                const latNum = parseFloat(s.latitude);
                const lngNum = parseFloat(s.longitude);
                return (isNaN(latNum) || isNaN(lngNum)) ? null : {
                    name: s.name, lat: latNum, lng: lngNum, address: s.address || '住所情報なし'
                };
            })
            .filter(s => s !== null);
        
        return true;
    } catch (error) {
        console.error("データの読み込み中にエラーが発生しました:", error);
        return false;
    }
}

// ----------------------------------------------------
// 3. RESULT画面のロジック 
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
    document.getElementById('nearest-shelter-info-display').textContent = `最寄りの避難所を検索中...`;

    loadAllData().then(dataLoaded => {
        if (dataLoaded) {
            // 基本的な表示処理
            calculateAndDisplaySupply(familySize, durationDays);
            displayGeneralNecessities();
            displayHazardInfoOnly(selectedCity); 
            
            // ★★★ AI提案の取得を開始 ★★★
            const aiArea = document.getElementById('ai-proposal-area');
            if (aiArea) {
                fetchAIGeminiProposal(familySize, durationDays, selectedCity, aiArea);
            }

            // Google Maps 連携
            const fullAddress = `愛知県${inputParams.city}${inputParams.addr}`;
            loadGoogleMapsAPI(fullAddress); 
            
            const showMapButton = document.getElementById('show-map-button');
            const closeShelterButton = document.getElementById('close-shelter-button');
            
            if (showMapButton) showMapButton.addEventListener('click', handleMapDisplay); 
            if (closeShelterButton) closeShelterButton.addEventListener('click', closeShelterMap);

        } else {
            document.getElementById('hazard-info-section').innerHTML = "<p>データ読み込みエラー</p>";
        }
    });
}

// ----------------------------------------------------
// 4. Google Maps & 避難所検索ロジック (省略せず維持)
// ----------------------------------------------------

function loadGoogleMapsAPI(fullAddress) {
    if (googleMapsLoaded) {
        geocodeAndDisplayShelter(fullAddress); 
        return;
    }
    const script = document.createElement('script');
    window.fullAddressForMap = fullAddress; 
    script.src = `https://maps.googleapis.com/maps/api/js?key=${API_KEY}&libraries=geometry&callback=initMapAndSearch`; 
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
}

window.initMapAndSearch = function() {
    googleMapsLoaded = true;
    geocoder = new google.maps.Geocoder();
    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: 35.1802, lng: 136.9051 }, 
        zoom: 10,
    });
    if (window.fullAddressForMap) geocodeAndDisplayShelter(window.fullAddressForMap); 
}

function geocodeAndDisplayShelter(fullAddress) {
    geocoder.geocode({ 'address': fullAddress }, (results, status) => {
        if (status === 'OK' && results[0]) {
            findAndDisplayNearestShelter(results[0].geometry.location);
        } else {
            document.getElementById('nearest-shelter-info-display').textContent = '住所の特定に失敗しました。';
        }
    });
}

function findAndDisplayNearestShelter(centerLatLng) {
    let nearestShelter = null;
    let minDistance = Infinity;

    if (google.maps.geometry && appData.shelter.length > 0) {
        appData.shelter.forEach(shelter => {
            const shelterLatLng = new google.maps.LatLng(shelter.lat, shelter.lng);
            const distance = google.maps.geometry.spherical.computeDistanceBetween(centerLatLng, shelterLatLng); 
            if (distance < minDistance) {
                minDistance = distance;
                nearestShelter = shelter;
            }
        });
    }

    if (nearestShelter) {
        const distanceKm = (minDistance / 1000).toFixed(2);
        nearestShelterData = { ...nearestShelter, centerLatLng: centerLatLng, distanceKm: distanceKm };
        document.getElementById('nearest-shelter-info-display').innerHTML = `
            最寄りの避難所: <strong>${nearestShelter.name}</strong> (約 ${distanceKm} km)<br>
            <span style="font-size:0.9em;">住所：${nearestShelter.address}</span>
        `;
        document.getElementById('show-map-button').style.display = 'block';
    }
}

function handleMapDisplay() {
    document.getElementById('map-area').style.display = 'block';
    document.getElementById('show-map-button').style.display = 'none';
    document.getElementById('close-shelter-button').style.display = 'block';
    if (map) {
        google.maps.event.trigger(map, 'resize');
        renderShelterMap(nearestShelterData);
    }
}

function renderShelterMap(data) {
    map.setCenter(data.centerLatLng);
    map.setZoom(15); 
    new google.maps.Marker({ position: data.centerLatLng, map: map, title: '自宅' });
    new google.maps.Marker({ position: new google.maps.LatLng(data.lat, data.lng), map: map, title: data.name });
}

function closeShelterMap() {
    document.getElementById('map-area').style.display = 'none';
    document.getElementById('show-map-button').style.display = 'block';
    document.getElementById('close-shelter-button').style.display = 'none';
}

// ----------------------------------------------------
// 5. ハザード表示・備蓄計算ロジック
// ----------------------------------------------------

function displayHazardInfoOnly(selectedCity) {
    const hazardData = appData.hazard.find(d => d.city_name_jp === selectedCity); 
    const maxShindoEl = document.getElementById('max-shindo');
    const tsunamiStatusEl = document.getElementById('tsunami-height-status');
    const tsunamiWarningEl = document.getElementById('tsunami-warning-message'); 

    if (hazardData) {
        maxShindoEl.textContent = hazardData.max_shindo || 'データなし';
        const tsunamiHeight = hazardData.max_tsunami_height_m;
        if (typeof tsunamiHeight === 'number' && tsunamiHeight > 0) {
            tsunamiStatusEl.textContent = `${tsunamiHeight}m`;
            tsunamiWarningEl.innerHTML = '<br>⚠️ 揺れがおさまったら速やかに高台へ避難してください。';
        } else {
            tsunamiStatusEl.textContent = tsunamiHeight === 0 ? "心配ありません" : 'データなし';
        }
    }
}

function calculateAndDisplaySupply(familySize, durationDays) {
    const standards = appData.supply.unit_standards;
    const container = document.getElementById('detailed-supply-list');
    let htmlContent = '';

    standards.forEach(item => {
        const totalBaseAmount = item.amount_per_person_day * durationDays * familySize;
        htmlContent += `<div class="bichiku-category"><h4>${item.item_jp} (目安: ${totalBaseAmount}${item.unit})</h4><ul>`;
        if (item.breakdown_items) {
            item.breakdown_items.forEach(bi => {
                let count = item.item_en === 'water' ? Math.ceil(totalBaseAmount * bi.allocation_ratio / bi.volume_l) : bi.amount_per_person_day * durationDays * familySize;
                htmlContent += `<li>${bi.item_name_jp}: ${count} ${item.item_en === 'water' ? '本' : '個'}</li>`;
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

// ----------------------------------------------------
// 6. AI提案ロジック (Gemini API) ★新規
// ----------------------------------------------------

async function fetchAIGeminiProposal(size, days, city, displayElement) {
    displayElement.innerHTML = `<p style="color: #666;">AIが${city}に合わせた献立を考案中...</p>`;

    const prompt = `愛知県${city}に住む${size}人家族の${days}日分の備蓄献立を、主食・副食・補助食に分けてHTMLタグ(<ul><li>)で具体的に提案してください。`;

    try {
        const response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await response.json();
        const aiText = data.candidates[0].content.parts[0].text;
        displayElement.innerHTML = `<div class="ai-box"><h5>✨ AIによる${city}専用アドバイス</h5>${aiText}</div>`;
    } catch (e) {
        displayElement.innerHTML = "<p>AI提案の取得に失敗しました。</p>";
    }
}

document.addEventListener('DOMContentLoaded', initResult);