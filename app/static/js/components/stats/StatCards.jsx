import React from 'react';
import { Card, CardContent } from '@ui/card';
import { Clock, Calendar, CheckCircle, Timer } from 'lucide-react';

const formatDuration = (totalSeconds) => {
  if (!totalSeconds || totalSeconds === 0) return '—';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
};

const formatCount = (v) => (v ? v : '—');

const statConfig = [
  { key: 'total_practice_seconds', label: 'Total practice time', icon: Clock, format: formatDuration },
  { key: 'days_practiced', label: 'Days practiced', icon: Calendar, format: formatCount },
  { key: 'items_completed', label: 'Items completed', icon: CheckCircle, format: formatCount },
  { key: 'avg_item_seconds', label: 'Avg time per item', icon: Timer, format: formatDuration },
];

const StatCards = ({ summary }) => {
  if (!summary) return null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {statConfig.map(({ key, label, icon: Icon, format }) => (
        <Card key={key} className="bg-gray-800 border-gray-700">
          <CardContent className="p-4 flex flex-col items-center text-center gap-1">
            <Icon className="h-5 w-5 text-orange-400 mb-1" />
            <span className="text-2xl font-bold text-white">{format(summary[key])}</span>
            <span className="text-xs text-gray-400">{label}</span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default StatCards;
