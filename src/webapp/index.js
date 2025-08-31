import './styles.css';

class DataConnectorConfig {
    constructor() {
        this.deltaTimerConfig = null;
        this.subscriptionConfig = null;
        this.init();
    }

    async init() {
        await this.loadConfigurations();
        this.setupEventListeners();
        this.updateUI();
        this.updateStatus();
    }

    async loadConfigurations() {
        try {
            // Load delta timer configuration
            const deltaResponse = await fetch('/plugins/signalk-data-connector/config/delta_timer.json');
            this.deltaTimerConfig = await deltaResponse.json();

            // Load subscription configuration
            const subResponse = await fetch('/plugins/signalk-data-connector/config/subscription.json');
            this.subscriptionConfig = await subResponse.json();

        } catch (error) {
            this.showNotification('Error loading configurations: ' + error.message, 'error');
        }
    }

    setupEventListeners() {
        // Delta timer save button
        document.getElementById('saveDeltaTimer').addEventListener('click', () => {
            this.saveDeltaTimer();
        });

        // Subscription save button
        document.getElementById('saveSubscription').addEventListener('click', () => {
            this.saveSubscription();
        });

        // Add path button
        document.getElementById('addPath').addEventListener('click', () => {
            this.addPathItem();
        });

        // JSON editor sync
        document.getElementById('subscriptionJson').addEventListener('input', (e) => {
            this.syncFromJson();
        });

        // Context input change
        document.getElementById('context').addEventListener('input', () => {
            this.updateJsonFromForm();
        });
    }

    updateUI() {
        // Update delta timer input
        if (this.deltaTimerConfig && this.deltaTimerConfig.deltaTimer) {
            document.getElementById('deltaTimer').value = this.deltaTimerConfig.deltaTimer;
        }

        // Update subscription configuration
        if (this.subscriptionConfig) {
            document.getElementById('context').value = this.subscriptionConfig.context || '*';
            
            // Clear existing paths
            document.getElementById('pathsList').innerHTML = '';
            
            // Add subscription paths
            if (this.subscriptionConfig.subscribe && Array.isArray(this.subscriptionConfig.subscribe)) {
                this.subscriptionConfig.subscribe.forEach(sub => {
                    this.addPathItem(sub.path);
                });
            }

            // Update JSON editor
            document.getElementById('subscriptionJson').value = JSON.stringify(this.subscriptionConfig, null, 2);
        }
    }

    addPathItem(path = '') {
        const pathsList = document.getElementById('pathsList');
        const pathItem = document.createElement('div');
        pathItem.className = 'path-item';
        
        pathItem.innerHTML = `
            <input type="text" value="${path}" placeholder="navigation.position" class="path-input">
            <button type="button" class="btn btn-danger" onclick="this.parentElement.remove(); window.dataConnectorConfig.updateJsonFromForm();">Remove</button>
        `;
        
        // Add event listener for input changes
        pathItem.querySelector('.path-input').addEventListener('input', () => {
            this.updateJsonFromForm();
        });
        
        pathsList.appendChild(pathItem);
        this.updateJsonFromForm();
    }

    updateJsonFromForm() {
        const context = document.getElementById('context').value || '*';
        const pathInputs = document.querySelectorAll('.path-input');
        const subscribe = Array.from(pathInputs)
            .map(input => ({ path: input.value }))
            .filter(sub => sub.path.trim() !== '');

        const config = {
            context: context,
            subscribe: subscribe
        };

        document.getElementById('subscriptionJson').value = JSON.stringify(config, null, 2);
    }

    syncFromJson() {
        try {
            const jsonText = document.getElementById('subscriptionJson').value;
            const config = JSON.parse(jsonText);
            
            // Update context
            document.getElementById('context').value = config.context || '*';
            
            // Update paths
            const pathsList = document.getElementById('pathsList');
            pathsList.innerHTML = '';
            
            if (config.subscribe && Array.isArray(config.subscribe)) {
                config.subscribe.forEach(sub => {
                    this.addPathItem(sub.path || '');
                });
            }
            
        } catch (error) {
            // Invalid JSON, don't update form
            console.warn('Invalid JSON in editor:', error.message);
        }
    }

    async saveDeltaTimer() {
        const deltaTimer = parseInt(document.getElementById('deltaTimer').value);
        
        if (isNaN(deltaTimer) || deltaTimer < 100 || deltaTimer > 10000) {
            this.showNotification('Delta timer must be between 100 and 10000 milliseconds', 'error');
            return;
        }

        const config = { deltaTimer: deltaTimer };

        try {
            const response = await fetch('/plugins/signalk-data-connector/config/delta_timer.json', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(config)
            });

            if (response.ok) {
                this.deltaTimerConfig = config;
                this.showNotification('Delta timer configuration saved successfully!', 'success');
                this.updateStatus();
            } else {
                throw new Error('Failed to save configuration');
            }
        } catch (error) {
            this.showNotification('Error saving delta timer: ' + error.message, 'error');
        }
    }

    async saveSubscription() {
        try {
            const jsonText = document.getElementById('subscriptionJson').value;
            const config = JSON.parse(jsonText);

            // Validate configuration
            if (!config.context) {
                throw new Error('Context is required');
            }

            if (!config.subscribe || !Array.isArray(config.subscribe)) {
                throw new Error('Subscribe array is required');
            }

            const response = await fetch('/plugins/signalk-data-connector/config/subscription.json', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(config)
            });

            if (response.ok) {
                this.subscriptionConfig = config;
                this.showNotification('Subscription configuration saved successfully!', 'success');
                this.updateStatus();
            } else {
                throw new Error('Failed to save configuration');
            }
        } catch (error) {
            this.showNotification('Error saving subscription: ' + error.message, 'error');
        }
    }

    updateStatus() {
        const statusDiv = document.getElementById('status');
        let statusHtml = '<h4>Configuration Status</h4>';

        // Delta timer status
        if (this.deltaTimerConfig) {
            statusHtml += `
                <div class="status-item">
                    <strong>Delta Timer:</strong> ${this.deltaTimerConfig.deltaTimer}ms
                    <span class="status-indicator success">✓ Configured</span>
                </div>
            `;
        } else {
            statusHtml += `
                <div class="status-item">
                    <strong>Delta Timer:</strong> 
                    <span class="status-indicator warning">⚠ Not configured</span>
                </div>
            `;
        }

        // Subscription status
        if (this.subscriptionConfig && this.subscriptionConfig.subscribe) {
            const pathCount = this.subscriptionConfig.subscribe.length;
            statusHtml += `
                <div class="status-item">
                    <strong>Subscriptions:</strong> ${pathCount} path(s) configured
                    <span class="status-indicator success">✓ Configured</span>
                </div>
                <div class="status-details">
                    <strong>Context:</strong> ${this.subscriptionConfig.context}<br>
                    <strong>Paths:</strong> ${this.subscriptionConfig.subscribe.map(s => s.path).join(', ')}
                </div>
            `;
        } else {
            statusHtml += `
                <div class="status-item">
                    <strong>Subscriptions:</strong> 
                    <span class="status-indicator warning">⚠ Not configured</span>
                </div>
            `;
        }

        statusDiv.innerHTML = statusHtml;
    }

    showNotification(message, type = 'success') {
        const notification = document.getElementById('notification');
        notification.textContent = message;
        notification.className = `notification ${type} show`;

        setTimeout(() => {
            notification.classList.remove('show');
        }, 4000);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.dataConnectorConfig = new DataConnectorConfig();
});

// Export for global access
export default DataConnectorConfig;