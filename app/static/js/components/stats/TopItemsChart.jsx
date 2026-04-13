import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@ui/card';
import { formatDuration, formatAxisMinutes } from '@components/stats/formatters';

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  return (
    <div className="bg-gray-800 border border-gray-600 rounded-md px-3 py-2 text-sm shadow-lg">
      <p className="text-white font-medium mb-1">{data.item_name}</p>
      <p className="text-orange-400">{formatDuration(data.total_seconds)}</p>
      <p className="text-gray-400">{data.practice_count} sessions</p>
    </div>
  );
};

const TopItemsChart = ({ data }) => {
  if (!data || data.length === 0) {
    return (
      <Card className="bg-gray-800 border-gray-700">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg text-white">Most practiced items</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-400 text-sm text-center py-8">No practice data for this period</p>
        </CardContent>
      </Card>
    );
  }

  const chartData = data.map((d) => ({
    ...d,
    minutes: Math.round((d.total_seconds || 0) / 60),
    short_name: d.item_name.length > 40 ? d.item_name.slice(0, 37) + '…' : d.item_name,
  }));

  const chartHeight = Math.max(200, chartData.length * 40 + 40);

  return (
    <Card className="bg-gray-800 border-gray-700 ph-no-capture">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg text-white">Most practiced items</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" horizontal={false} />
            <XAxis
              type="number"
              stroke="#9ca3af"
              tick={{ fill: '#9ca3af', fontSize: 12 }}
              tickFormatter={formatAxisMinutes}
            />
            <YAxis
              type="category"
              dataKey="short_name"
              width={220}
              stroke="#9ca3af"
              tick={{ fill: '#9ca3af', fontSize: 12 }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="minutes" fill="#f97316" radius={[0, 4, 4, 0]} barSize={24} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};

export default TopItemsChart;
