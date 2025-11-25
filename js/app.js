// =====================================================================
// 愛知マイ備蓄ナビ - コアロジック (app.js) - 機能再構成版
// 💡 修正点: 備蓄品の詳細な計算と表示ロジックを実装
// =====================================================================

// ----------------------------------------------------
// 1. 定数とグローバル変数の定義
// ----------------------------------------------------

const API_KEY = "AIzaSyAV0j-JNMRDpyvwk-6OxhpPzKLhG5fT9IE"; // ★★★ Google Maps APIキーに置き換えてください ★★★
const DATA_PATHS = {
    // パスはそのまま維持
    CITIES: '../data/aichi_cities.json', 
    HAZARD: '../data/hazard_data.json',   
    SUPPLY: '../data/supply_data.json',   
    SHELTER: '../data/shelter_list.json'  
};
let appData = {};
let map, geocoder; // geocoderは地図初期化時に定義
let googleMapsLoaded = false; // Google Maps APIのロード状態を追跡

// ----------------------------------------------------
// 2. データの読み込み処理 (shelterデータの座標を数値に変換)
// ----------------------------------------------------

async function loadAllData() {
    console.log("データの読み込みを開始...");
    
    const loadPromises = [
        fetch(DATA_PATHS.CITIES).then(res => res.json()).catch(() => []), 
        fetch(DATA_PATHS.HAZARD).then(res => res.json()).catch(() => []),
        // 💡 修正: supplyデータの読み込み時にgeneral_necessitiesも考慮
        fetch(DATA_PATHS.SUPPLY).then(res => res.json()).catch(() => ({unit_standards: [], general_necessities: []})),
        fetch(DATA_PATHS.SHELTER)
            .then(res => res.json())
            .catch((error) => {
                console.error("Shelter data not found or failed to parse. Using empty list.", error);
                return []; 
            })
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
                
                if (isNaN(latNum) || isNaN(lngNum)) {
                    return null; 
                }
                
                return {
                    name: s.name,
                    lat: latNum,
                    lng: lngNum,
                    address: s.address || '住所情報なし'
                };
            })
            .filter(s => s !== null);
        
        console.log("データ読み込み完了:", appData);
        return true;
    } catch (error) {
        console.error("データの読み込み中に致命的なエラーが発生しました:", error);
        return false;
    }
}

// ----------------------------------------------------
// 3. HOME画面 (home.html) のロジック 
// ----------------------------------------------------

function initHome() {
    const searchButton = document.getElementById('search-button');
    searchButton.addEventListener('click', handleHomeSearch);
    
    loadAllData().then(dataLoaded => {
        if (dataLoaded) {
            populateCitySelect();
        } else {
            searchButton.disabled = true;
        }
    });
}

function populateCitySelect() {
    const citySelect = document.getElementById('city-select');
    if (Array.isArray(appData.cities) && appData.cities.length > 0) {
        let optionsHtml = ''; 
        appData.cities.forEach(cityObj => {
            const cityName = cityObj.city_name_jp;
            optionsHtml += `<option value="${cityName}">${cityName}</option>`;
        });
        citySelect.insertAdjacentHTML('beforeend', optionsHtml);
    } else {
        citySelect.insertAdjacentHTML('beforeend', '<option value="" disabled>データ読み込みエラー</option>');
    }
}

/**
 * home.htmlの検索ボタン処理
 * 💡 変更点: detailedAddressの取得を削除
 */
function handleHomeSearch() {
    const selectedCity = document.getElementById('city-select').value;
    // detailedAddressはhome.htmlで入力しないため、ここでは取得しない
    const familySize = document.getElementById('family-size').value;
    const durationDays = document.getElementById('duration-days').value;

    if (!selectedCity || familySize <= 0 || durationDays <= 0) {
        alert("市町村、人数、日数を正しく入力してください。");
        return;
    }

    const query = new URLSearchParams({
        city: selectedCity,
        // address: detailedAddress, // 💡 削除
        size: familySize,
        days: durationDays
    }).toString();

    window.location.href = `result.html?${query}`;
}

// ----------------------------------------------------
// 4. RESULT画面 (result.html) のロジック 
// ----------------------------------------------------

function initResult() {
    const params = new URLSearchParams(window.location.search);
    const selectedCity = params.get('city');
    const familySize = parseInt(params.get('size'), 10);
    const durationDays = parseInt(params.get('days'), 10);
    
    if (!selectedCity || !familySize || !durationDays) {
        alert("必要な入力情報がありません。ホーム画面に戻ります。");
        window.location.href = 'home.html';
        return;
    }

    // 💡 変更点: target-full-addressには市町村名のみ表示
    document.getElementById('target-full-address').textContent = `愛知県 ${selectedCity}`; 
    document.getElementById('summary-family-size').textContent = familySize;
    document.getElementById('summary-duration-days').textContent = durationDays;

    loadAllData().then(dataLoaded => {
        if (dataLoaded) {
            // APIに依存しない処理
            calculateAndDisplaySupply(familySize, durationDays);
            displayGeneralNecessities(); // 💡 新規追加: 一般的な必需品の表示
            displayHazardInfoOnly(selectedCity); 
            
            // 💡 変更点: ボタンイベントリスナーを追加
            const searchShelterButton = document.getElementById('search-shelter-button');
            const closeShelterButton = document.getElementById('close-shelter-button'); // 💡 追加
            
            if (searchShelterButton) {
                searchShelterButton.addEventListener('click', () => {
                    handleShelterSearch(selectedCity);
                });
            }
            // 💡 追加: 閉じるボタンのイベントリスナー
            if (closeShelterButton) {
                closeShelterButton.addEventListener('click', closeShelterMap);
            }

        } else {
            document.getElementById('hazard-info-section').innerHTML = "<p>データ読み込みエラー</p>";
        }
    });
}

/**
 * Google Maps APIを動的にロードし、地図を表示する
 * @param {string} fullAddress - Geocodingに使用する住所
 */
function loadGoogleMapsAPI(fullAddress) {
    if (googleMapsLoaded) {
        // すでにロード済みの場合は、即座にジオコーディングを実行
        geocodeAndDisplayShelter(fullAddress);
        return;
    }

    const script = document.createElement('script');
    window.fullAddressForMap = fullAddress; // ジオコーディング用住所をグローバルに保持
    
    // geometryライブラリは距離計算に必須
    script.src = `https://maps.googleapis.com/maps/api/js?key=${API_KEY}&libraries=geometry&callback=initMapAndSearch`; 
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
}

/**
 * Google Maps APIロード後のコールバック関数
 */
window.initMapAndSearch = function() {
    googleMapsLoaded = true;
    geocoder = new google.maps.Geocoder();
    
    // 地図の初期化 (中心は愛知県庁付近)
    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: 35.1802, lng: 136.9051 }, 
        zoom: 10,
    });

    const fullAddress = window.fullAddressForMap; 
    
    // APIロード完了後、すぐに避難所検索を開始
    if (fullAddress) {
        geocodeAndDisplayShelter(fullAddress); 
    }
}

// ----------------------------------------------------
// 5. 機能ごとのロジック
// ----------------------------------------------------

/**
 * 💡 修正: 避難所検索ボタンクリック時のメイン処理
 * @param {string} selectedCity - home.htmlで選択された市町村
 */
function handleShelterSearch(selectedCity) {
    const detailedAddress = document.getElementById('detailed-address-result').value;
    const mapArea = document.getElementById('map-area');
    const nearestShelterInfo = document.getElementById('nearest-shelter-info');
    
    // 💡 追加: ボタン要素の取得
    const searchButton = document.getElementById('search-shelter-button');
    const closeButton = document.getElementById('close-shelter-button');


    if (!detailedAddress) {
        alert("詳細な住所を入力してください。");
        return;
    }

    // 検索エリアを表示に切り替える
    mapArea.style.display = 'block';
    nearestShelterInfo.textContent = '地図機能を読み込み中...';
    
    // 💡 変更点: ボタンの表示切替
    searchButton.style.display = 'none';
    closeButton.style.display = 'block';

    // Geocoding用に「愛知県」と市町村、詳細住所を結合
    const fullAddress = `愛知県${selectedCity}${detailedAddress}`; 

    // Google Maps APIのロードと検索を開始
    loadGoogleMapsAPI(fullAddress); 
}

/**
 * 💡 新規追加: 避難所マップを非表示にする
 */
function closeShelterMap() {
    const mapArea = document.getElementById('map-area');
    const nearestShelterInfo = document.getElementById('nearest-shelter-info');
    
    // 💡 追加: ボタン要素の取得
    const searchButton = document.getElementById('search-shelter-button');
    const closeButton = document.getElementById('close-shelter-button');

    // 地図エリアを非表示に
    mapArea.style.display = 'none';
    nearestShelterInfo.textContent = '検索ボタンを押してください...';
    
    // 💡 変更点: ボタンの表示切替
    searchButton.style.display = 'block';
    closeButton.style.display = 'none';
}


/**
 * Google Maps APIに依存せず、ハザードデータのみを表示する
 */
function displayHazardInfoOnly(selectedCity) {
    const searchCityName = selectedCity; 
    const hazardData = appData.hazard.find(d => d.city_name_jp === searchCityName); 
    
    const maxShindoEl = document.getElementById('max-shindo');
    const tsunamiStatusEl = document.getElementById('tsunami-height-status');
    const tsunamiWarningEl = document.getElementById('tsunami-warning-message'); 

    // リセット
    maxShindoEl.textContent = '取得中...';
    tsunamiStatusEl.textContent = '取得中...';
    tsunamiWarningEl.textContent = ''; 

    if (hazardData) {
        maxShindoEl.textContent = hazardData.max_shindo || 'データなし';
        
        const tsunamiHeight = hazardData.max_tsunami_height_m;

        if (typeof tsunamiHeight === 'number' && tsunamiHeight > 0) {
            // 津波高が設定されている場合
            tsunamiStatusEl.textContent = `${tsunamiHeight}m`;
            tsunamiWarningEl.innerHTML = '<br> ⚠️ <strong> 想定津波警戒地域です。<br></strong>震災発生時はすぐに避難所へ向かうのではなく、<br><strong>揺れがおさまったら速やかに高台へ避難</strong>してください。';
            
        } else if (tsunamiHeight === 0) {
            tsunamiStatusEl.textContent = "心配ありません";
        } else {
            tsunamiStatusEl.textContent = tsunamiHeight || 'データなし';
        }
    } else {
        console.error(`ハザードデータが見つかりません: ${searchCityName}`);
        maxShindoEl.textContent = '該当データなし';
        tsunamiStatusEl.textContent = '該当データなし';
    }
}


/**
 * Geocoding（住所→座標変換）と避難所検索を実行する
 * 💡 変更点: initResultから分離され、ボタンクリック後にのみ実行される
 */
function geocodeAndDisplayShelter(fullAddress) {
    document.getElementById('nearest-shelter-info').textContent = '住所を座標に変換中...';

    geocoder.geocode({ 'address': fullAddress }, (results, status) => {
        if (status === 'OK' && results[0]) {
            const userLatLng = results[0].geometry.location;
            
            // Geocodingが成功したら避難所を検索・表示
            findAndDisplayNearestShelter(userLatLng);
        } else {
            console.error('Geocodingに失敗しました: ' + status);
            document.getElementById('nearest-shelter-info').textContent = `住所の特定に失敗しました（ステータス: ${status}）。住所を確認してください。`;
        }
    });
}

/**
 * 💡 大幅修正: 備蓄品の詳細計算と表示を行う（新しいsupply_data.jsonに対応）
 * @param {number} familySize - 家族の人数
 * @param {number} durationDays - 備蓄日数
 */
function calculateAndDisplaySupply(familySize, durationDays) {
    const standards = appData.supply.unit_standards;
    const container = document.getElementById('detailed-supply-list');
    let htmlContent = '';

    if (!standards || standards.length === 0) {
        container.innerHTML = '<p>備蓄データが見つかりませんでした。</p>';
        return;
    }

    standards.forEach(item => {
        const totalBaseAmount = item.amount_per_person_day * durationDays * familySize;
        const itemUnit = item.unit;

        // 備蓄品カテゴリのヘッダー
        htmlContent += `
            <div class="bichiku-category">
                <h4 style="margin-top: 20px;">${item.item_jp} (総量目安: ${totalBaseAmount.toLocaleString()}${itemUnit})</h4>
                <p class="note" style="font-size: 0.85em; color: #6c757d;">${item.note}</p>
        `;

        // 詳細品目（breakdown_items）がある場合
        if (item.breakdown_items && item.breakdown_items.length > 0) {
            htmlContent += '<div class="breakdown-list-container"><ul>';

            item.breakdown_items.forEach(breakdownItem => {
                let requiredCount = 0;
                let unitLabel = '';
                // 食料の場合はrecommended_product、水の場合はnote_jpを使用
                const note = breakdownItem.recommended_product || breakdownItem.note_jp || '';
                
                if (item.item_en === 'water' && breakdownItem.volume_l) {
                    // 水の計算: 総量L数 × 割合 / 標準容量L (小数点以下切り上げ)
                    // allocation_ratioがない場合は1(100%)と仮定
                    requiredCount = Math.ceil(totalBaseAmount * (breakdownItem.allocation_ratio || 1) / breakdownItem.volume_l);
                    unitLabel = '本';
                } else if (item.item_en === 'food_meal' && breakdownItem.amount_per_person_day) {
                    // 食料の計算: 1日あたり個数 × 日数 × 人数
                    requiredCount = breakdownItem.amount_per_person_day * durationDays * familySize;
                    unitLabel = '個';
                } 
                // 非常用トイレはbreakdownがないので、ここでは処理しない

                if (requiredCount > 0) {
                    // 💡 修正: liからインラインスタイルを削除し、クラスベースのスタイルに移行
                    htmlContent += `
                        <li class="breakdown-list-item">
                            <div class="breakdown-item-line">
                                <span class="item-name">${breakdownItem.item_name_jp}</span>
                                <span class="required-count">${requiredCount.toLocaleString()} ${unitLabel}</span>
                            </div>
                            <p class="recommended-note">${note}</p>
                        </li>
                    `;
                }
            });
            htmlContent += '</ul>'; // ulを閉じる

            // 💡 新規追加: 「など」を右揃えの専用divとして追加
            htmlContent += `
                <div class="list-suffix-right">
                    など
                </div>
            `;
            
            htmlContent += '</div>'; // breakdown-list-containerを閉じる

        } else {
             // breakdown_itemsがない場合 (例: 非常用トイレや計算不要なカテゴリ)
             htmlContent += `
                <div class="total-amount-box">
                    合計: <strong>${totalBaseAmount.toLocaleString()} ${item.unit}</strong>
                </div>
             `;
        }
        htmlContent += '</div>';
    });

    container.innerHTML = htmlContent;
}

/**
 * 💡 新規追加: 一般的な必需品リストを表示する
 */
function displayGeneralNecessities() {
    const necessities = appData.supply.general_necessities;
    const container = document.getElementById('general-necessities-list');
    let htmlContent = '';

    if (!necessities || necessities.length === 0) {
        container.innerHTML = '<li>追加の必需品データがありません。</li>';
        return;
    }

    necessities.forEach(item => {
        htmlContent += `
            <li>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 600;">${item.item_jp}</span>
                    <span class="unit-count">${item.unit_count}</span>
                </div>
                <p style="margin-top: 5px; font-size: 0.8em; color: #6c757d;">${item.note}</p>
            </li>
        `;
    });

    container.innerHTML = htmlContent;
}


function findAndDisplayNearestShelter(centerLatLng) {
    document.getElementById('nearest-shelter-info').textContent = '最寄りの避難所を検索中...';

    let nearestShelter = null;
    let minDistance = Infinity;

    if (google.maps.geometry && google.maps.geometry.spherical && appData.shelter.length > 0) {
        
        appData.shelter.forEach(shelter => {
            if (typeof shelter.lat !== 'number' || typeof shelter.lng !== 'number') {
                return; 
            }

            const shelterLatLng = new google.maps.LatLng(shelter.lat, shelter.lng);
            const distance = google.maps.geometry.spherical.computeDistanceBetween(centerLatLng, shelterLatLng); 
            
            if (distance < minDistance) {
                minDistance = distance;
                nearestShelter = shelter;
            }
        });
    }

    if (nearestShelter) {
        const shelterLatLng = new google.maps.LatLng(nearestShelter.lat, nearestShelter.lng);
        const distanceKm = (minDistance / 1000).toFixed(2);
        
        document.getElementById('nearest-shelter-info').innerHTML = `
            最寄りの避難所: <strong>${nearestShelter.name}</strong> (約 ${distanceKm} km)
        `;

        // 地図を中心とズームレベルを更新
        map.setCenter(centerLatLng);
        map.setZoom(15); 
        
        // ユーザーマーカー（入力住所）
        new google.maps.Marker({
            position: centerLatLng,
            map: map,
            title: '入力された住所',
            icon: { url: 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png' } // 青いピン
        });
        
        // 避難所マーカー
        new google.maps.Marker({
            position: shelterLatLng,
            map: map,
            title: nearestShelter.name,
            icon: { url: 'http://maps.google.com/mapfiles/ms/icons/red-dot.png' } // 赤いピン
        });
    } else {
        document.getElementById('nearest-shelter-info').textContent = "最寄りの避難所が見つかりませんでした。";
    }
}


// ----------------------------------------------------
// 6. アプリケーションの起動
// ----------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    const path = window.location.pathname;

    if (path.includes('result.html')) {
        initResult();
    } else if (path.includes('home.html') || path.endsWith('/')) {
        initHome();
    }
});