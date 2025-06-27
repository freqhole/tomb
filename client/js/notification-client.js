/**
 * WebSocket Notification Client Library
 *
 * Provides a JavaScript client for connecting to the WebSocket notification system,
 * handling real-time events, and managing subscriptions.
 */

class NotificationClient {
    constructor(options = {}) {
        this.url = options.url || this.getDefaultWebSocketUrl();
        this.reconnectInterval = options.reconnectInterval || 5000;
        this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
        this.debug = options.debug || false;

        this.socket = null;
        this.connectionId = null;
        this.isAuthenticated = false;
        this.subscribedChannels = new Set();
        this.reconnectAttempts = 0;
        this.isConnected = false;
        this.isReconnecting = false;

        // Event listeners
        this.eventListeners = {
            connect: [],
            disconnect: [],
            notification: [],
            error: [],
            subscribed: [],
            unsubscribed: []
        };

        // Channel-specific listeners
        this.channelListeners = {};

        this.log('NotificationClient initialized', { url: this.url });
    }

    /**
     * Get default WebSocket URL based on current page location
     */
    getDefaultWebSocketUrl() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        return `${protocol}//${host}/ws`;
    }

    /**
     * Connect to the WebSocket server
     */
    async connect() {
        if (this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)) {
            this.log('Already connected or connecting');
            return;
        }

        try {
            this.log('Connecting to WebSocket...', { url: this.url });
            this.socket = new WebSocket(this.url);

            this.socket.onopen = (event) => {
                this.log('WebSocket connected');
                this.isConnected = true;
                this.isReconnecting = false;
                this.reconnectAttempts = 0;
                this.emit('connect', { event });
            };

            this.socket.onmessage = (event) => {
                this.handleMessage(event.data);
            };

            this.socket.onclose = (event) => {
                this.log('WebSocket disconnected', { code: event.code, reason: event.reason });
                this.isConnected = false;
                this.connectionId = null;
                this.isAuthenticated = false;
                this.emit('disconnect', { event });

                // Attempt to reconnect if not manually closed
                if (event.code !== 1000 && !this.isReconnecting) {
                    this.attemptReconnect();
                }
            };

            this.socket.onerror = (event) => {
                this.log('WebSocket error', event);
                this.emit('error', { event, message: 'WebSocket connection error' });
            };

        } catch (error) {
            this.log('Failed to connect', error);
            this.emit('error', { error, message: 'Failed to establish WebSocket connection' });
            throw error;
        }
    }

    /**
     * Disconnect from the WebSocket server
     */
    disconnect() {
        this.log('Manually disconnecting');
        this.isReconnecting = false;

        if (this.socket) {
            this.socket.close(1000, 'Manual disconnect');
        }
    }

    /**
     * Attempt to reconnect with exponential backoff
     */
    attemptReconnect() {
        if (this.isReconnecting || this.reconnectAttempts >= this.maxReconnectAttempts) {
            if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                this.log('Max reconnect attempts reached');
                this.emit('error', { message: 'Maximum reconnection attempts exceeded' });
            }
            return;
        }

        this.isReconnecting = true;
        this.reconnectAttempts++;

        const delay = Math.min(this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1), 30000);
        this.log(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);

        setTimeout(() => {
            if (this.isReconnecting) {
                this.connect().catch((error) => {
                    this.log('Reconnect failed', error);
                    this.attemptReconnect();
                });
            }
        }, delay);
    }

    /**
     * Handle incoming WebSocket message
     */
    handleMessage(data) {
        try {
            const message = JSON.parse(data);
            this.log('Received message', message);

            switch (message.type) {
                case 'Welcome':
                    this.connectionId = message.data.connection_id;
                    this.isAuthenticated = message.data.user_id !== null;
                    this.log('Welcome received', {
                        connectionId: this.connectionId,
                        isAuthenticated: this.isAuthenticated
                    });
                    break;

                case 'Notification':
                    this.handleNotification(message.data);
                    break;

                case 'NotificationSubscribed':
                    this.subscribedChannels.add(message.data.channel);
                    this.emit('subscribed', message.data);
                    break;

                case 'NotificationUnsubscribed':
                    this.subscribedChannels.delete(message.data.channel);
                    this.emit('unsubscribed', message.data);
                    break;

                case 'NotificationStatus':
                    this.subscribedChannels = new Set(message.data.subscribed_channels);
                    this.connectionId = message.data.connection_id;
                    this.isAuthenticated = message.data.is_authenticated;
                    break;

                case 'Error':
                    this.emit('error', { message: message.data.message, code: message.data.code });
                    break;

                default:
                    this.log('Unknown message type', message.type);
            }

        } catch (error) {
            this.log('Failed to parse message', { data, error });
            this.emit('error', { error, message: 'Failed to parse WebSocket message' });
        }
    }

    /**
     * Handle notification message
     */
    handleNotification(notification) {
        this.log('Notification received', notification);

        // Emit general notification event
        this.emit('notification', notification);

        // Emit channel-specific event
        const channelListeners = this.channelListeners[notification.channel] || [];
        channelListeners.forEach(listener => {
            try {
                listener(notification);
            } catch (error) {
                this.log('Error in channel listener', { channel: notification.channel, error });
            }
        });
    }

    /**
     * Send message to server
     */
    send(message) {
        if (!this.isConnected || !this.socket) {
            throw new Error('WebSocket is not connected');
        }

        const messageStr = JSON.stringify(message);
        this.log('Sending message', message);
        this.socket.send(messageStr);
    }

    /**
     * Subscribe to a notification channel
     */
    subscribeToChannel(channel) {
        this.send({
            type: 'SubscribeToNotifications',
            data: { channel }
        });
    }

    /**
     * Unsubscribe from a notification channel
     */
    unsubscribeFromChannel(channel) {
        this.send({
            type: 'UnsubscribeFromNotifications',
            data: { channel }
        });
    }

    /**
     * Get notification status
     */
    getNotificationStatus() {
        this.send({
            type: 'GetNotificationStatus'
        });
    }

    /**
     * Send ping to server
     */
    ping() {
        this.send({ type: 'Ping' });
    }

    /**
     * Add event listener
     */
    on(event, listener) {
        if (!this.eventListeners[event]) {
            this.eventListeners[event] = [];
        }
        this.eventListeners[event].push(listener);
    }

    /**
     * Remove event listener
     */
    off(event, listener) {
        if (!this.eventListeners[event]) return;

        const index = this.eventListeners[event].indexOf(listener);
        if (index > -1) {
            this.eventListeners[event].splice(index, 1);
        }
    }

    /**
     * Add channel-specific notification listener
     */
    onChannel(channel, listener) {
        if (!this.channelListeners[channel]) {
            this.channelListeners[channel] = [];
        }
        this.channelListeners[channel].push(listener);
    }

    /**
     * Remove channel-specific notification listener
     */
    offChannel(channel, listener) {
        if (!this.channelListeners[channel]) return;

        const index = this.channelListeners[channel].indexOf(listener);
        if (index > -1) {
            this.channelListeners[channel].splice(index, 1);
        }
    }

    /**
     * Emit event to listeners
     */
    emit(event, data) {
        const listeners = this.eventListeners[event] || [];
        listeners.forEach(listener => {
            try {
                listener(data);
            } catch (error) {
                this.log('Error in event listener', { event, error });
            }
        });
    }

    /**
     * Get connection status
     */
    getStatus() {
        return {
            isConnected: this.isConnected,
            isAuthenticated: this.isAuthenticated,
            connectionId: this.connectionId,
            subscribedChannels: Array.from(this.subscribedChannels),
            reconnectAttempts: this.reconnectAttempts,
            isReconnecting: this.isReconnecting
        };
    }

    /**
     * Log debug message
     */
    log(message, data = null) {
        if (this.debug) {
            const timestamp = new Date().toISOString();
            if (data) {
                console.log(`[NotificationClient ${timestamp}] ${message}`, data);
            } else {
                console.log(`[NotificationClient ${timestamp}] ${message}`);
            }
        }
    }
}

/**
 * Notification channels enum
 */
const NotificationChannels = {
    MEDIA_BLOBS: 'MediaBlobs',
    THUMBNAIL_JOBS: 'ThumbnailJobs',
    SYSTEM: 'System'
};

/**
 * Helper function to create and configure a notification client
 */
function createNotificationClient(options = {}) {
    return new NotificationClient(options);
}

/**
 * Export for module systems
 */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { NotificationClient, NotificationChannels, createNotificationClient };
}

/**
 * Global export for browser
 */
if (typeof window !== 'undefined') {
    window.NotificationClient = NotificationClient;
    window.NotificationChannels = NotificationChannels;
    window.createNotificationClient = createNotificationClient;
}

/**
 * Example usage:
 *
 * const client = createNotificationClient({
 *     debug: true,
 *     reconnectInterval: 3000
 * });
 *
 * client.on('connect', () => {
 *     console.log('Connected to notification server');
 *     client.subscribeToChannel(NotificationChannels.MEDIA_BLOBS);
 * });
 *
 * client.on('notification', (notification) => {
 *     console.log('Received notification:', notification);
 * });
 *
 * client.onChannel(NotificationChannels.MEDIA_BLOBS, (notification) => {
 *     console.log('Media blob notification:', notification);
 * });
 *
 * client.connect();
 */
