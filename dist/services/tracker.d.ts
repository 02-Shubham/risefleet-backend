import EventEmitter from 'events';
export declare const trackerEvents: EventEmitter<any>;
export interface PingData {
    imei: string;
    lat: number;
    lng: number;
    speed: number;
    ignition: boolean;
    timestamp: Date;
}
export declare function handlePing(data: PingData): Promise<void>;
export declare function flushLogs(): Promise<void>;
export declare function startTracker(): void;
export declare function getHealth(): Promise<{
    pending_count: number;
    uptime_seconds: number;
}>;
export declare function stopTracker(): Promise<void>;
//# sourceMappingURL=tracker.d.ts.map