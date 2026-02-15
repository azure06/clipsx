import { Wifi, WifiOff, Cloud, CloudOff } from 'lucide-react'
import { useUIStore } from '../../stores'

type BottomBarProps = {
    // activeView handled by store
    status?: string
    isOnline?: boolean
    isSynced?: boolean
}

export const BottomBar = ({ status = "Ready", isOnline = true, isSynced = true }: BottomBarProps) => {
    const { activeView } = useUIStore()
    return (
        <div className="flex h-6 w-full shrink-0 select-none items-center justify-between px-3 text-[10px] text-gray-500 bg-transparent">

            {/* Left: Status Message */}
            <div className="flex items-center gap-2">
                <span className="opacity-70">{status}</span>
            </div>

            {/* Center: Active View Indicator (Optional, maybe redundant if sidebar highlights) */}
            <div className="font-medium opacity-50 uppercase tracking-widest hidden md:block">
                {activeView}
            </div>

            {/* Right: System Status Icons */}
            <div className="flex items-center gap-3">
                {isSynced ? (
                    <div className="flex items-center gap-1 text-gray-500" title="Synced">
                        <Cloud className="h-3 w-3" />
                    </div>
                ) : (
                    <div className="flex items-center gap-1 text-gray-500" title="Sync Paused">
                        <CloudOff className="h-3 w-3" />
                    </div>
                )}

                {isOnline ? (
                    <div className="flex items-center gap-1 text-gray-500" title="Online">
                        <Wifi className="h-3 w-3" />
                    </div>
                ) : (
                    <div className="flex items-center gap-1 text-gray-500" title="Offline">
                        <WifiOff className="h-3 w-3" />
                    </div>
                )}
            </div>
        </div>
    )
}
