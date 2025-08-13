// weather-widget.js - Complete JavaScript implementation with enhanced error handling

// Network utility class for handling retries and timeouts
class NetworkUtils {
    static async fetchWithRetry(url, options = {}, maxRetries = 3) {
        const defaultOptions = {
            timeout: 10000, // 10 seconds timeout
            ...options
        };

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), defaultOptions.timeout);
                
                const response = await fetch(url, {
                    ...defaultOptions,
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                return response;
                
            } catch (error) {
                if (attempt === maxRetries) {
                    if (error.name === 'AbortError') {
                        throw new Error('Request timeout - please check your internet connection and try again');
                    }
                    if (error.name === 'TypeError') {
                        throw new Error('Network connection failed - please check your internet connection');
                    }
                    throw error;
                }
                
                // Exponential backoff delay
                const delay = Math.pow(2, attempt - 1) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    static validateCityName(cityName) {
        if (!cityName || typeof cityName !== 'string') {
            throw new Error('City name is required');
        }
        
        const trimmed = cityName.trim();
        if (trimmed.length === 0) {
            throw new Error('City name cannot be empty');
        }
        
        if (trimmed.length < 2) {
            throw new Error('City name must be at least 2 characters long');
        }
        
        if (trimmed.length > 100) {
            throw new Error('City name is too long (max 100 characters)');
        }
        
        // Check for potentially harmful characters
        const dangerousChars = /[<>\"'&]/;
        if (dangerousChars.test(trimmed)) {
            throw new Error('City name contains invalid characters');
        }
        
        return trimmed;
    }
}

// Weather service layer for API interactions
class WeatherService {
    constructor() {
        this.baseURL = 'https://api.open-meteo.com/v1/forecast';
        this.geocodingURL = 'https://geocoding-api.open-meteo.com/v1/search';
    }

    async getCoordinates(cityName) {
        try {
            const validatedCity = NetworkUtils.validateCityName(cityName);
            const url = `${this.geocodingURL}?name=${encodeURIComponent(validatedCity)}&count=1&language=en&format=json`;
            
            const response = await NetworkUtils.fetchWithRetry(url);
            const data = await response.json();
            
            if (!data.results || data.results.length === 0) {
                throw new Error(`No results found for "${validatedCity}". Please check the spelling or try a different city name.`);
            }
            
            const location = data.results[0];
            
            // Validate location data
            if (!location.latitude || !location.longitude || !location.name) {
                throw new Error('Invalid location data received from server');
            }
            
            return {
                latitude: parseFloat(location.latitude),
                longitude: parseFloat(location.longitude),
                name: location.name,
                country: location.country || 'Unknown',
                admin1: location.admin1 || null
            };
        } catch (error) {
            if (error.message.includes('No results found') || error.message.includes('Invalid location')) {
                throw error; // Re-throw user-friendly errors as-is
            }
            throw new Error(`Unable to find location: ${error.message}`);
        }
    }

    async getWeatherData(latitude, longitude) {
        try {
            // Validate coordinates
            if (!latitude || !longitude || isNaN(latitude) || isNaN(longitude)) {
                throw new Error('Invalid coordinates provided');
            }
            
            if (latitude < -90 || latitude > 90) {
                throw new Error('Invalid latitude (must be between -90 and 90)');
            }
            
            if (longitude < -180 || longitude > 180) {
                throw new Error('Invalid longitude (must be between -180 and 180)');
            }
            
            const params = new URLSearchParams({
                latitude: latitude.toString(),
                longitude: longitude.toString(),
                current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl,visibility',
                daily: 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_sum,wind_speed_10m_max',
                hourly: 'temperature_2m,weather_code',
                timezone: 'auto',
                forecast_days: 5,
                temperature_unit: 'fahrenheit',
                wind_speed_unit: 'mph'
            });

            const url = `${this.baseURL}?${params}`;
            const response = await NetworkUtils.fetchWithRetry(url);
            const data = await response.json();
            
            // Validate weather data structure
            if (!data.current || !data.daily || !data.hourly) {
                throw new Error('Invalid weather data format received from server');
            }
            
            return data;
        } catch (error) {
            if (error.message.includes('Invalid coordinates') || error.message.includes('Invalid latitude') || error.message.includes('Invalid longitude')) {
                throw error; // Re-throw validation errors as-is
            }
            throw new Error(`Unable to fetch weather data: ${error.message}`);
        }
    }

    async searchCities(query) {
        try {
            // Validate search query
            if (!NetworkUtils.validateCityName(query)) {
                return []; // Return empty array for invalid queries
            }
            
            const url = `${this.geocodingURL}?name=${encodeURIComponent(query)}&count=5&language=en&format=json`;
            const response = await NetworkUtils.fetchWithRetry(url);
            const data = await response.json();
            
            return data.results || [];
        } catch (error) {
            console.warn('City search failed:', error);
            return []; // Return empty array on error to prevent UI breakage
        }
    }

    async reverseGeocode(latitude, longitude) {
        try {
            // Use OpenStreetMap Nominatim for reverse geocoding (free, no API key needed)
            const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10&addressdetails=1`;
            
            // Add User-Agent header as required by Nominatim usage policy
            const response = await NetworkUtils.fetchWithRetry(url, {
                headers: {
                    'User-Agent': 'WeatherWidget/1.0 (https://myfirstsite.local)'
                }
            });
            const data = await response.json();
            
            if (data && data.address) {
                const address = data.address;
                
                // Extract city name (try different fields)
                const city = address.city || address.town || address.village || address.municipality || address.hamlet || 'Unknown City';
                
                // Extract state/region (try different fields)
                const state = address.state || address.region || address.province || address.county || '';
                
                // Extract country
                const country = address.country || 'Unknown Country';
                
                return {
                    name: city,
                    country: country,
                    admin1: state,
                    latitude: latitude,
                    longitude: longitude
                };
            }
            
            // Fallback if no results
            return {
                name: 'Your Location',
                country: 'Current Location',
                admin1: '',
                latitude: latitude,
                longitude: longitude
            };
        } catch (error) {
            console.warn('Reverse geocoding failed:', error);
            // Return fallback location info
            return {
                name: 'Your Location',
                country: 'Current Location', 
                admin1: '',
                latitude: latitude,
                longitude: longitude
            };
        }
    }
}

// Data processing layer
class WeatherDataProcessor {
    static processCurrentWeather(data, locationInfo) {
        const current = data.current;
        const daily = data.daily;
        const hourly = data.hourly;
        
        // Get current hour index for hourly data
        const currentTime = new Date();
        const currentHour = currentTime.getHours();
        
        return {
            location: {
                name: locationInfo.name,
                country: locationInfo.country,
                admin1: locationInfo.admin1,
                fullName: `${locationInfo.name}${locationInfo.admin1 ? `, ${locationInfo.admin1}` : ''}, ${locationInfo.country}`
            },
            current: {
                temperature: Math.round(current.temperature_2m),
                feelsLike: Math.round(current.apparent_temperature),
                humidity: current.relative_humidity_2m,
                windSpeed: Math.round(current.wind_speed_10m),
                windDirection: current.wind_direction_10m,
                pressure: current.pressure_msl ? Math.round(current.pressure_msl) : null,
                visibility: current.visibility ? Math.round(current.visibility / 1000) : null,
                weatherCode: current.weather_code,
                description: this.getWeatherDescription(current.weather_code),
                icon: this.getWeatherIcon(current.weather_code),
                time: new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
            },
            today: {
                maxTemp: Math.round(daily.temperature_2m_max[0]),
                minTemp: Math.round(daily.temperature_2m_min[0]),
                feelsLikeMax: Math.round(daily.apparent_temperature_max[0]),
                feelsLikeMin: Math.round(daily.apparent_temperature_min[0]),
                precipitation: daily.precipitation_sum[0] || 0,
                maxWind: Math.round(daily.wind_speed_10m_max[0])
            },
            hourly: this.processHourlyForecast(hourly, currentHour)
        };
    }

    static processHourlyForecast(hourly, currentHour) {
        const hourlyForecast = [];
        
        // Get next 12 hours starting from current hour
        for (let i = 0; i < 12; i++) {
            const hourIndex = currentHour + i;
            if (hourIndex < hourly.time.length) {
                const time = new Date(hourly.time[hourIndex]);
                hourlyForecast.push({
                    time: time.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
                    hour: time.getHours(),
                    temperature: Math.round(hourly.temperature_2m[hourIndex]),
                    weatherCode: hourly.weather_code[hourIndex],
                    icon: this.getWeatherIcon(hourly.weather_code[hourIndex])
                });
            }
        }
        
        return hourlyForecast;
    }

    static processForecast(data) {
        const daily = data.daily;
        const forecast = [];
        
        // Start from tomorrow (index 1)
        for (let i = 1; i < daily.time.length; i++) {
            const date = new Date(daily.time[i]);
            forecast.push({
                date: date,
                dayName: this.getDayName(date),
                shortDay: this.getShortDayName(date),
                weatherCode: daily.weather_code[i],
                description: this.getWeatherDescription(daily.weather_code[i]),
                icon: this.getWeatherIcon(daily.weather_code[i]),
                maxTemp: Math.round(daily.temperature_2m_max[i]),
                minTemp: Math.round(daily.temperature_2m_min[i]),
                feelsLikeMax: Math.round(daily.apparent_temperature_max[i]),
                feelsLikeMin: Math.round(daily.apparent_temperature_min[i]),
                precipitation: daily.precipitation_sum[i] || 0,
                maxWind: Math.round(daily.wind_speed_10m_max[i])
            });
        }
        
        return forecast;
    }

    static getWeatherDescription(code) {
        const weatherCodes = {
            0: 'Clear sky',
            1: 'Mainly clear',
            2: 'Partly cloudy',
            3: 'Overcast',
            45: 'Fog',
            48: 'Depositing rime fog',
            51: 'Light drizzle',
            53: 'Moderate drizzle',
            55: 'Dense drizzle',
            56: 'Light freezing drizzle',
            57: 'Dense freezing drizzle',
            61: 'Slight rain',
            63: 'Moderate rain',
            65: 'Heavy rain',
            66: 'Light freezing rain',
            67: 'Heavy freezing rain',
            71: 'Slight snow fall',
            73: 'Moderate snow fall',
            75: 'Heavy snow fall',
            77: 'Snow grains',
            80: 'Slight rain showers',
            81: 'Moderate rain showers',
            82: 'Violent rain showers',
            85: 'Slight snow showers',
            86: 'Heavy snow showers',
            95: 'Thunderstorm',
            96: 'Thunderstorm with slight hail',
            99: 'Thunderstorm with heavy hail'
        };
        
        return weatherCodes[code] || 'Unknown';
    }

    static getWeatherIcon(code) {
        const iconMap = {
            0: '☀️',
            1: '🌤️',
            2: '⛅',
            3: '☁️',
            45: '🌫️',
            48: '🌫️',
            51: '🌦️',
            53: '🌦️',
            55: '🌦️',
            56: '🌦️',
            57: '🌦️',
            61: '🌧️',
            63: '🌧️',
            65: '🌧️',
            66: '🌧️',
            67: '🌧️',
            71: '🌨️',
            73: '🌨️',
            75: '🌨️',
            77: '🌨️',
            80: '🌦️',
            81: '🌦️',
            82: '🌦️',
            85: '🌨️',
            86: '🌨️',
            95: '⛈️',
            96: '⛈️',
            99: '⛈️'
        };
        
        return iconMap[code] || '❓';
    }

    static getDayName(date) {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return days[date.getDay()];
    }

    static getShortDayName(date) {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        return days[date.getDay()];
    }

    static getWindDirection(degrees) {
        const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
        const index = Math.round(degrees / 22.5) % 16;
        return directions[index];
    }
}

// Main weather widget UI controller
class WeatherWidget {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.weatherService = new WeatherService();
        this.currentLocationInfo = null;
        this.searchSuggestions = [];
        this.showHourlyForecast = false;
    }

    async init(defaultCity = 'London') {
        this.container.innerHTML = this.getLoadingHTML();
        
        try {
            await this.loadWeather(defaultCity);
        } catch (error) {
            this.showError('Failed to load initial weather data', error.message);
        }
    }

    async initWithCoordinates(latitude, longitude) {
        this.container.innerHTML = this.getLoadingHTML();
        
        try {
            // Get location name from coordinates using reverse geocoding
            const locationInfo = await this.weatherService.reverseGeocode(latitude, longitude);
            this.currentLocationInfo = locationInfo;
            
            // Get weather data using coordinates
            const weatherData = await this.weatherService.getWeatherData(latitude, longitude);
            
            // Validate weather data structure
            if (!weatherData || !weatherData.current || !weatherData.daily) {
                throw new Error('Invalid weather data received. Please try again.');
            }
            
            // Process and render the data
            const currentWeather = WeatherDataProcessor.processCurrentWeather(weatherData, locationInfo);
            const forecast = WeatherDataProcessor.processForecast(weatherData);
            
            this.render(currentWeather, forecast);
            
        } catch (error) {
            console.error('Error loading weather with coordinates:', error);
            // Fallback to default city if coordinate-based loading fails
            this.showError('Failed to load location-based weather', 'Falling back to default location...');
            setTimeout(() => this.init('London'), 2000);
        }
    }

    async loadWeather(cityName) {
        this.showLoading();
        
        try {
            // Validate input using NetworkUtils
            if (!NetworkUtils.validateCityName(cityName)) {
                throw new Error('Please enter a valid city name (letters, spaces, and basic punctuation only)');
            }
            
            // Get coordinates for the city
            const locationInfo = await this.weatherService.getCoordinates(cityName);
            if (!locationInfo) {
                throw new Error(`Unable to find coordinates for "${cityName}". Please check the spelling and try again.`);
            }
            
            this.currentLocationInfo = locationInfo;
            
            // Get weather data
            const weatherData = await this.weatherService.getWeatherData(
                locationInfo.latitude, 
                locationInfo.longitude
            );
            
            // Validate weather data structure
            if (!weatherData || !weatherData.current || !weatherData.daily) {
                throw new Error('Invalid weather data received. Please try again.');
            }
            
            // Process and render the data
            const currentWeather = WeatherDataProcessor.processCurrentWeather(weatherData, locationInfo);
            const forecast = WeatherDataProcessor.processForecast(weatherData);
            
            this.render(currentWeather, forecast);
            
        } catch (error) {
            console.error('Error loading weather:', error);
            
            // Provide user-friendly error messages
            let userMessage = 'Failed to load weather data';
            if (error.message.includes('valid city name')) {
                userMessage = 'Invalid city name';
            } else if (error.message.includes('Unable to find coordinates')) {
                userMessage = `City not found: "${cityName}"`;
            } else if (error.message.includes('network') || error.message.includes('fetch')) {
                userMessage = 'Network connection problem';
            } else if (error.message.includes('timeout')) {
                userMessage = 'Request timed out - please try again';
            }
            
            this.showError(userMessage, error.message);
        }
    }

    render(currentWeather, forecast) {
        const html = `
            <div class="search-section">
                <div class="search-container">
                    <div class="search-input-container">
                        <input type="text" class="search-input" placeholder="Enter city name..." id="cityInput" autocomplete="off">
                        <div class="search-suggestions" id="searchSuggestions"></div>
                    </div>
                    <button class="search-btn" id="searchBtn">🔍</button>
                </div>
            </div>

            <div class="current-weather fade-in">
                <div class="location-name">
                    ${currentWeather.location.fullName}
                </div>
                <div class="current-time">Updated: ${currentWeather.current.time}</div>
                <div class="weather-icon">${currentWeather.current.icon}</div>
                <div class="temperature">${currentWeather.current.temperature}°F</div>
                <div class="feels-like">Feels like ${currentWeather.current.feelsLike}°F</div>
                <div class="weather-description">${currentWeather.current.description}</div>
            </div>

            <div class="weather-details fade-in">
                <div class="detail-item">
                    <div class="detail-label">High / Low</div>
                    <div class="detail-value">${currentWeather.today.maxTemp}° / ${currentWeather.today.minTemp}°</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Humidity</div>
                    <div class="detail-value">${currentWeather.current.humidity}%</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Wind Speed</div>
                    <div class="detail-value">${currentWeather.current.windSpeed} mph ${WeatherDataProcessor.getWindDirection(currentWeather.current.windDirection)}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-label">Precipitation</div>
                    <div class="detail-value">${currentWeather.today.precipitation} mm</div>
                </div>
                ${currentWeather.current.pressure ? `
                <div class="detail-item">
                    <div class="detail-label">Pressure</div>
                    <div class="detail-value">${currentWeather.current.pressure} hPa</div>
                </div>
                ` : ''}
                ${currentWeather.current.visibility ? `
                <div class="detail-item">
                    <div class="detail-label">Visibility</div>
                    <div class="detail-value">${currentWeather.current.visibility} km</div>
                </div>
                ` : ''}
            </div>

            <div class="forecast-toggle-section">
                <button class="forecast-toggle-btn" id="hourlyToggle">
                    ${this.showHourlyForecast ? '📅 Daily Forecast' : '🕐 Hourly Forecast'}
                </button>
            </div>

            <div class="forecast-section fade-in">
                <div class="forecast-title">
                    ${this.showHourlyForecast ? '12-Hour Forecast' : '5-Day Forecast'}
                </div>
                <div class="forecast-list" id="forecastList">
                    ${this.showHourlyForecast ? this.renderHourlyForecast(currentWeather.hourly) : this.renderDailyForecast(forecast)}
                </div>
            </div>
        `;
        
        this.container.innerHTML = html;
        this.attachEventListeners();
    }

    renderHourlyForecast(hourlyData) {
        return hourlyData.map(hour => `
            <div class="forecast-item hourly-item">
                <div class="forecast-time">${hour.time}</div>
                <div class="forecast-icon">${hour.icon}</div>
                <div class="forecast-temp">${hour.temperature}°</div>
            </div>
        `).join('');
    }

    renderDailyForecast(forecast) {
        return forecast.map(day => `
            <div class="forecast-item daily-item" title="Feels like ${day.feelsLikeMax}°/${day.feelsLikeMin}°, Wind: ${day.maxWind} mph">
                <div class="forecast-day">${day.dayName}</div>
                <div class="forecast-desc">${day.description}</div>
                <div class="forecast-temps">
                    <span class="temp-high">${day.maxTemp}°</span>
                    <span class="temp-low">${day.minTemp}°</span>
                </div>
                ${day.precipitation > 0 ? `<div class="precipitation">💧 ${day.precipitation}mm</div>` : ''}
            </div>
        `).join('');
    }

    showLoading() {
        this.container.innerHTML = this.getLoadingHTML();
    }

    getLoadingHTML() {
        return `
            <div class="loading">
                <div class="loading-spinner"></div>
                <div class="loading-text">Loading weather data...</div>
            </div>
        `;
    }

    showError(title, message) {
        const html = `
            <div class="error">
                <div class="error-icon">⚠️</div>
                <div class="error-message">${title}</div>
                <div class="error-details">${message}</div>
                <div class="error-actions">
                    <button class="search-btn" onclick="this.closest('.weather-widget').querySelector('.search-input')?.focus()" style="margin-right: 10px;">
                        Try Different City
                    </button>
                    <button class="search-btn" onclick="location.reload()">
                        Reload Widget
                    </button>
                </div>
            </div>
        `;
        
        this.container.innerHTML = html;
        
        // Auto-retry after 5 seconds for network errors
        if (message.includes('network') || message.includes('timeout') || message.includes('fetch')) {
            setTimeout(() => {
                if (this.currentLocationInfo) {
                    this.loadWeather(this.currentLocationInfo.name);
                }
            }, 5000);
        }
    }

    attachEventListeners() {
        const searchBtn = document.getElementById('searchBtn');
        const cityInput = document.getElementById('cityInput');
        const hourlyToggle = document.getElementById('hourlyToggle');
        const searchSuggestions = document.getElementById('searchSuggestions');
        
        if (searchBtn && cityInput) {
            // Search button click
            searchBtn.addEventListener('click', () => {
                const cityName = cityInput.value.trim();
                if (cityName) {
                    // Validate input before proceeding
                    try {
                        if (!NetworkUtils.validateCityName(cityName)) {
                            this.showError('Invalid Input', 'Please enter a valid city name (letters, spaces, and basic punctuation only)');
                            return;
                        }
                        this.loadWeather(cityName);
                        this.hideSuggestions();
                    } catch (error) {
                        this.showError('Invalid Input', error.message);
                    }
                } else {
                    this.showError('Empty Input', 'Please enter a city name');
                }
            });
            
            // Enter key press
            cityInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    const cityName = cityInput.value.trim();
                    if (cityName) {
                        // Validate input before proceeding
                        try {
                            if (!NetworkUtils.validateCityName(cityName)) {
                                this.showError('Invalid Input', 'Please enter a valid city name (letters, spaces, and basic punctuation only)');
                                return;
                            }
                            this.loadWeather(cityName);
                            this.hideSuggestions();
                        } catch (error) {
                            this.showError('Invalid Input', error.message);
                        }
                    } else {
                        this.showError('Empty Input', 'Please enter a city name');
                    }
                }
            });
            
            // Search suggestions (with debounce)
            let searchTimeout;
            cityInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                const query = e.target.value.trim();
                
                if (query.length >= 2) {
                    // Basic validation before searching
                    try {
                        if (NetworkUtils.validateCityName(query)) {
                            searchTimeout = setTimeout(() => {
                                this.showSearchSuggestions(query);
                            }, 300);
                        } else {
                            this.hideSuggestions();
                        }
                    } catch (error) {
                        this.hideSuggestions();
                    }
                } else {
                    this.hideSuggestions();
                }
            });
            
            // Hide suggestions when clicking outside
            document.addEventListener('click', (e) => {
                if (!cityInput.contains(e.target) && !searchSuggestions.contains(e.target)) {
                    this.hideSuggestions();
                }
            });
            
            // Set current city as placeholder
            if (this.currentLocationInfo) {
                cityInput.placeholder = `Search for a city... (Current: ${this.currentLocationInfo.name})`;
            }
        }
        
        // Hourly/Daily forecast toggle
        if (hourlyToggle) {
            hourlyToggle.addEventListener('click', () => {
                this.showHourlyForecast = !this.showHourlyForecast;
                // Re-render just the forecast section
                this.updateForecastSection();
            });
        }
    }

    async showSearchSuggestions(query) {
        try {
            const suggestions = await this.weatherService.searchCities(query);
            this.searchSuggestions = suggestions;
            
            const suggestionsContainer = document.getElementById('searchSuggestions');
            if (suggestions.length > 0) {
                const html = suggestions.map(city => `
                    <div class="suggestion-item" data-city="${city.name}" data-country="${city.country}" data-lat="${city.latitude}" data-lng="${city.longitude}">
                        ${city.name}${city.admin1 ? `, ${city.admin1}` : ''}, ${city.country}
                    </div>
                `).join('');
                
                suggestionsContainer.innerHTML = html;
                suggestionsContainer.style.display = 'block';
                
                // Add click listeners to suggestions
                suggestionsContainer.querySelectorAll('.suggestion-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const cityName = item.dataset.city;
                        document.getElementById('cityInput').value = cityName;
                        this.loadWeather(cityName);
                        this.hideSuggestions();
                    });
                });
            } else {
                this.hideSuggestions();
            }
        } catch (error) {
            console.warn('Failed to fetch search suggestions:', error);
            this.hideSuggestions();
        }
    }

    hideSuggestions() {
        const suggestionsContainer = document.getElementById('searchSuggestions');
        if (suggestionsContainer) {
            suggestionsContainer.style.display = 'none';
            suggestionsContainer.innerHTML = '';
        }
    }

    updateForecastSection() {
        // Re-fetch current data to update forecast display
        if (this.currentLocationInfo) {
            this.loadWeather(this.currentLocationInfo.name);
        }
    }
}

// Initialize the widget when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const widget = new WeatherWidget('weatherWidget');
    widget.init('London');
});
