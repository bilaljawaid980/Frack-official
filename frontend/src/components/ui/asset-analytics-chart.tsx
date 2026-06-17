"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

type AssetAnalyticsPoint = {
  month: string;
  issued: number;
  net: number;
};

const fallbackData: AssetAnalyticsPoint[] = [
  { month: "Jan", issued: 12000, net: 12000 },
  { month: "Feb", issued: 18000, net: 18000 },
  { month: "Mar", issued: 24000, net: 24000 },
  { month: "Apr", issued: 21000, net: 21000 },
  { month: "May", issued: 26000, net: 26000 },
  { month: "Jun", issued: 30000, net: 30000 },
  { month: "Jul", issued: 33000, net: 33000 },
  { month: "Aug", issued: 36000, net: 36000 },
  { month: "Sep", issued: 39000, net: 39000 },
  { month: "Oct", issued: 42000, net: 42000 },
];

export function AssetAnalyticsChart({
  data = fallbackData,
}: {
  data?: AssetAnalyticsPoint[];
}) {
  return (
    <ResponsiveContainer width="100%" height={350}>
      <LineChart
        data={data}
        margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
      >
        <defs>
          <linearGradient id="colorIssued" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#2A5FA6" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#2A5FA6" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorNet" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#60A5FA" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#60A5FA" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="month" stroke="#999" style={{ fontSize: "12px" }} />
        <YAxis stroke="#999" style={{ fontSize: "12px" }} />
        <Tooltip
          contentStyle={{
            backgroundColor: "white",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
          }}
        />
        <Legend wrapperStyle={{ paddingTop: "20px" }} iconType="circle" />
        <Line
          type="monotone"
          dataKey="issued"
          stroke="#2A5FA6"
          strokeWidth={3}
          fill="url(#colorIssued)"
          fillOpacity={1}
          dot={{ fill: "#2A5FA6", r: 4 }}
          activeDot={{ r: 6 }}
          name="Issued Tokens"
        />
        <Line
          type="monotone"
          dataKey="net"
          stroke="#60A5FA"
          strokeDasharray="6 4"
          strokeWidth={2}
          fill="url(#colorNet)"
          dot={false}
          name="Circulating Tokens"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}