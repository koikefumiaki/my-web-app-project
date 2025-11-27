// =====================================================================
// 愛知マイ備蓄ナビ - RESULT画面ロジック (result.js)
// 役割: 結果の表示、備蓄計算、ハザード情報表示、避難所検索（Google Maps）
// =====================================================================

// ----------------------------------------------------
// 1. 定数とグローバル変数の定義 (home.jsと共通)
// ----------------------------------------------------

const API_KEY = "AIzaSyAV0j-JNMRDpyvwk-6OxhpPzKLhG5fT9IE"; // ★★★ Google Maps APIキーに置き換えてください ★★★
const DATA_PATHS = {
    CITIES: '/my-web-app-project/data/aichi_cities.json', 
    HAZARD: '/my-web-app-project/data/hazard_data.json',   
    SUPPLY: '/my-web-app-project/data/supply_data.json',   
    SHELTER: '/my-web-app-project/data/shelter_list.json'  
};
let appData = {};
let map, geocoder; // Google Mapsオブジェクト
let googleMapsLoaded = false; // Google Maps APIのロード状態を追跡

// 【変更】ユーザーの入力情報と特定された避難所情報を保持する変数
let inputParams = {};
let nearestShelterData = null; // 特定された最寄りの避難所データを保持

// ----------------------------------------------------
// 2. データの読み込み処理 (home.jsと共通)
// ----------------------------------------------------

/**
 * すべてのデータを非同期でロードし、appDataオブジェクトに格納する。
 * @returns {Promise<boolean>} データロードが成功したかどうか
 */
async function loadAllData() {
    console.log("データの読み込みを開始...");
    
    const loadPromises = [
        fetch(DATA_PATHS.CITIES).then(res => res.json()).catch(() => []), 
        fetch(DATA_PATHS.HAZARD).then(res => res.json()).catch(() => []),
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
        
        // 避難所データは座標を数値に変換し、無効なデータを除外
        appData.shelter = shelterRaw
            .map(s => {
                const latNum = parseFloat(s.latitude);
                const lngNum = parseFloat(s.longitude);
                return (isNaN(latNum) || isNaN(lngNum)) ? null : {
                    name: s.name, lat: latNum, lng: lngNum, address: s.address || '住所情報なし'
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
// 3. RESULT画面のロジック 
// ----------------------------------------------------

/**
 * RESULT画面の初期化処理
 */
function initResult() {
    const params = new URLSearchParams(window.location.search);
    const selectedCity = params.get('city');
    const familySize = parseInt(params.get('size'), 10);
    const durationDays = parseInt(params.get('days'), 10);
    const address = params.get('addr');
    
    // グローバル変数に格納
    inputParams = {
        city: selectedCity,
        size: familySize,
        days: durationDays,
        addr: address
    };
    
    if (!selectedCity || !familySize || !durationDays || !address) {
        alert("必要な入力情報がありません。ホーム画面に戻ります。");
        window.location.href = 'index.html';
        return;
    }

    // 画面サマリー情報の表示
    document.getElementById('target-full-address').textContent = `愛知県 ${selectedCity} ${address}`;
    document.getElementById('summary-family-size').textContent = familySize;
    document.getElementById('summary-duration-days').textContent = durationDays;
    
    // ★★★ 修正: 避難所名表示エリアの初期メッセージを設定 ★★★
    document.getElementById('nearest-shelter-info-display').textContent = `最寄りの避難所を検索中...`;

    loadAllData().then(dataLoaded => {
        if (dataLoaded) {
            // APIに依存しない処理を実行
            calculateAndDisplaySupply(familySize, durationDays);
            displayGeneralNecessities();
            displayHazardInfoOnly(selectedCity); 
            
            // ★★★ 修正: ページロード時に避難所検索ロジックを開始する ★★★
            const fullAddress = `愛知県${inputParams.city}${inputParams.addr}`;
            loadGoogleMapsAPI(fullAddress); 
            
            // 地図表示ボタンのイベントリスナー設定
            const showMapButton = document.getElementById('show-map-button');
            const closeShelterButton = document.getElementById('close-shelter-button');
            
            if (showMapButton) {
                showMapButton.addEventListener('click', handleMapDisplay); 
            }
            if (closeShelterButton) {
                closeShelterButton.addEventListener('click', closeShelterMap);
            }

        } else {
            document.getElementById('hazard-info-section').innerHTML = "<p>データ読み込みエラー</p>";
        }
    });
}


// ----------------------------------------------------
// 4. Google Maps & 避難所検索ロジック
// ----------------------------------------------------

/**
 * Google Maps APIを動的にロードし、地図の初期化とGeocodingを開始する。
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
    
    // 地図の初期化 (コンテナが非表示でもオブジェクトは作成される)
    map = new google.maps.Map(document.getElementById('map'), {
        center: { lat: 35.1802, lng: 136.9051 }, 
        zoom: 10,
    });

    const fullAddress = window.fullAddressForMap; 
    
    // APIロード完了後、すぐに避難所検索を開始し、避難所名を特定する
    if (fullAddress) {
        geocodeAndDisplayShelter(fullAddress); 
    }
}

/**
 * Geocoding（住所→座標変換）と避難所検索を実行する
 */
function geocodeAndDisplayShelter(fullAddress) {
    document.getElementById('nearest-shelter-info-display').textContent = '住所を座標に変換中...';

    geocoder.geocode({ 'address': fullAddress }, (results, status) => {
        if (status === 'OK' && results[0]) {
            const userLatLng = results[0].geometry.location;
            
            // Geocodingが成功したら避難所を検索し、結果を画面に反映
            findAndDisplayNearestShelter(userLatLng);
        } else {
            console.error('Geocodingに失敗しました: ' + status);
            document.getElementById('nearest-shelter-info-display').textContent = `住所の特定に失敗しました（ステータス: ${status}）。住所を確認してください。`;
            document.getElementById('show-map-button').style.display = 'none'; // 失敗時はボタンも非表示
        }
    });
}

/**
 * 最寄りの避難所を計算し、情報欄に表示する。
 * 地図の表示は、地図ボタンが押されたときのみ行う。
 */
function findAndDisplayNearestShelter(centerLatLng) {
    document.getElementById('nearest-shelter-info-display').textContent = '最寄りの避難所を検索中...'; 

    let nearestShelter = null;
    let minDistance = Infinity;
    const isMapVisible = document.getElementById('map-area').style.display !== 'none';

    if (google.maps.geometry && google.maps.geometry.spherical && appData.shelter.length > 0) {
        
        appData.shelter.forEach(shelter => {
            if (typeof shelter.lat !== 'number' || typeof shelter.lng !== 'number') return; 

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
        
        // ★★★ 避難所データをグローバルに保存 (地図表示時に使用) ★★★
        nearestShelterData = {
            ...nearestShelter,
            centerLatLng: centerLatLng, 
            distanceKm: distanceKm
        };
        
        // ★★★ 避難所名表示エリアを更新 (ページロード時に実行される) ★★★
        document.getElementById('nearest-shelter-info-display').innerHTML = `
            最寄りの避難所: <strong>${nearestShelter.name}</strong> (約 ${distanceKm} km)
        `;
        
        // ★★★ 地図ボタンを表示 ★★★
        document.getElementById('show-map-button').style.display = 'block';

        // 地図が表示状態なら、マーカーなどを描画 (ボタンクリックで表示された場合)
        if (isMapVisible && map) {
             renderShelterMap(nearestShelterData);
        }

    } else {
        document.getElementById('nearest-shelter-info-display').textContent = "最寄りの避難所が見つかりませんでした。";
        document.getElementById('show-map-button').style.display = 'none';
    }
}

/**
 * 地図描画専用のヘルパー関数 (新規追加)
 */
function renderShelterMap(data) {
    if (!map || !data || !data.centerLatLng) return;

    // マーカーをリセットする処理をここに含めるのが望ましいですが、ここでは単純に新規作成
    
    // マップの表示を更新
    map.setCenter(data.centerLatLng);
    map.setZoom(15); 
    
    // ユーザーマーカー（入力住所）
    new google.maps.Marker({
        position: data.centerLatLng,
        map: map,
        title: '入力された住所',
        icon: { url: 'http://maps.google.com/mapfiles/ms/icons/blue-dot.png' } // 青いピン
    });
    
    // 避難所マーカー
    new google.maps.Marker({
        position: new google.maps.LatLng(data.lat, data.lng),
        map: map,
        title: data.name,
        icon: { url: 'http://maps.google.com/mapfiles/ms/icons/red-dot.png' } // 赤いピン
    });
}

/**
 * 地図表示ボタンクリック時のメイン処理
 */
function handleMapDisplay() {
    const mapArea = document.getElementById('map-area');
    const showMapButton = document.getElementById('show-map-button');
    const closeButton = document.getElementById('close-shelter-button');
    const shelterInfoEl = document.getElementById('nearest-shelter-info-display');


    if (!nearestShelterData) {
         shelterInfoEl.textContent = 'エラー: 避難所情報が特定できていません。ページを再読み込みしてください。';
         return;
    }

    // 検索エリアを表示に切り替える
    mapArea.style.display = 'block';
    
    // ボタンの表示切替
    showMapButton.style.display = 'none';
    closeButton.style.display = 'block';

    // 地図が隠れた状態で初期化された場合、リサイズイベントをトリガーして地図を正しく描画
    if (map) {
        google.maps.event.trigger(map, 'resize');
        renderShelterMap(nearestShelterData);
    }
}

/**
 * 避難所マップを非表示にする
 */
function closeShelterMap() {
    const mapArea = document.getElementById('map-area');
    const showMapButton = document.getElementById('show-map-button');
    const closeButton = document.getElementById('close-shelter-button');

    // 地図エリアを非表示に
    mapArea.style.display = 'none';
    
    // ボタンの表示切替
    showMapButton.style.display = 'block';
    closeButton.style.display = 'none';
}


// ----------------------------------------------------
// 5. ハザード・備蓄計算ロジック
// ----------------------------------------------------

/**
 * ハザードデータのみを表示する
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

// ----------------------------------------------------
// ★★★ 新規追加: 推奨品目の文字列をHTMLリストに変換するヘルパー関数 ★★★
// ----------------------------------------------------


// result.js の formatRecommendedProduct 関数 (修正案)

/**
 * JSON内の '例 ・〇〇・〇〇' 形式の文字列をHTMLリストに変換する。
 * 改行マーク ":<br>" を認識し、リスト内に改行を挿入する。
 */
function formatRecommendedProduct(productString) {
    if (!productString || typeof productString !== 'string') return '';
    
    // "例 " をヘッダーとして抽出
    let cleanedString = productString.replace(/例\s*/, '例:');
    
    // 区切り文字 '|' で分割（各リスト項目）
    cleanedString = cleanedString.replace(/\s・\s*/g, '|'); // 各リスト項目を '|' で区切る
    
    const parts = cleanedString.split('|');
    const header = parts[0].trim();
    const items = parts.slice(1);
    
    let html = '';

    if (header) {
        html += `<span class="recommended-product-header">${header}</span>`;
    }
    
    if (items.length > 0 && items.some(item => item.trim() !== '')) {
        html += '<ul class="recommended-product-list">';
        items.forEach(item => {
            const trimmedItem = item.trim();
            if (trimmedItem) {
                // ★★★ ここが修正の核心 ★★★
                // ":<br>" を改行とインデントを伴うHTMLに置換
                const formattedItem = trimmedItem.replace(/:\s*<br>\s*/g, `<br><span class="recommended-sub-item">`);
                
                // <li> タグを閉じ、リストアイテムの「・」をカスタムCSSに任せるため、項目を生成
                // 最後の <span> を閉じるために、ここで </span> を追加
                html += `<li>${formattedItem}</span></li>`; 
            }
        });
        html += '</ul>';
    }
    
    return html;
}

// ----------------------------------------------------
// 5. 備蓄計算ロジック
// ----------------------------------------------------

/**
 * 備蓄品の詳細計算と表示を行う
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
                
                // ★★★ 修正: recommended_product を formatRecommendedProduct 関数で処理する ★★★
                // note_jp もあれば一緒に渡すことを考慮
                const recommendedHtml = formatRecommendedProduct(breakdownItem.recommended_product || breakdownItem.note_jp || '');
                
                if (item.item_en === 'water' && breakdownItem.volume_l) {
                    // 水の計算: 総量L数 × 割合 / 標準容量L (小数点以下切り上げ)
                    requiredCount = Math.ceil(totalBaseAmount * (breakdownItem.allocation_ratio || 1) / breakdownItem.volume_l);
                    unitLabel = '本';
                } else if (item.item_en === 'food_meal' && breakdownItem.amount_per_person_day) {
                    // 食料の計算: 1日あたり個数 × 日数 × 人数
                    requiredCount = breakdownItem.amount_per_person_day * durationDays * familySize;
                    unitLabel = '個';
                } 

                if (requiredCount > 0) {
                    htmlContent += `
                        <li class="breakdown-list-item">
                            <div class="breakdown-item-line">
                                <span class="item-name">${breakdownItem.item_name_jp}</span>
                                <span class="required-count">${requiredCount.toLocaleString()} ${unitLabel}</span>
                            </div>
                            <div class="recommended-note">${recommendedHtml}</div> 
                        </li>
                    `;
                }
            });
            htmlContent += '</ul>'; // ulを閉じる

            // 「など」を右揃えの専用divとして追加
            htmlContent += `
                <div class="list-suffix-right">
                    など
                </div>
            `;
            
            htmlContent += '</div>'; // breakdown-list-containerを閉じる

        } else {
             // breakdown_itemsがない場合 
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
 * 一般的な必需品リストを表示する
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

// ----------------------------------------------------
// 6. アプリケーションの起動
// ----------------------------------------------------

// DOMContentLoaded後に初期化関数を呼び出す
document.addEventListener('DOMContentLoaded', initResult);