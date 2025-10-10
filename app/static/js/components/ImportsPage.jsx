import React, { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@ui/card';
import { Button } from '@ui/button';
import { Textarea } from '@ui/textarea';
import { Label } from '@ui/label';
import { AlertCircle, CheckCircle } from 'lucide-react';
import { useRoutines } from '@hooks/useRoutines';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@ui/select';

export default function ImportsPage() {
    const [itemsData, setItemsData] = useState('');
    const [routinesData, setRoutinesData] = useState('');
    const [routineItemsData, setRoutineItemsData] = useState('');
    const [selectedRoutineId, setSelectedRoutineId] = useState('');
    const { routines, loading: routinesLoading } = useRoutines();

    const handleItemsImport = async () => {
        try {
            const data = JSON.parse(itemsData);
            const response = await fetch('/api/items/import', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });
            if (!response.ok) {
                throw new Error('Failed to import items');
            }
            setItemsData('');
        } catch (err) {
            console.error('Import error:', err);
        }
    };

    const handleRoutinesImport = async () => {
        try {
            const data = JSON.parse(routinesData);
            const response = await fetch('/api/routines/import', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });
            if (!response.ok) {
                throw new Error('Failed to import routines');
            }
            setRoutinesData('');
        } catch (err) {
            console.error('Import error:', err);
        }
    };

    const handleRoutineItemsImport = async () => {
        try {
            if (!selectedRoutineId) {
                throw new Error('Please select a routine first');
            }
            const data = JSON.parse(routineItemsData);
            const response = await fetch(`/api/routines/${selectedRoutineId}/items/import`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });
            if (!response.ok) {
                throw new Error('Failed to import routine items');
            }
            setRoutineItemsData('');
        } catch (err) {
            console.error('Import error:', err);
        }
    };

    return (
        <Card className="w-full max-w-4xl bg-gray-900 text-gray-100">
            <CardContent className="space-y-6">
                <div>
                    <CardTitle className="text-2xl mb-4">Import Items</CardTitle>
                    <p className="text-gray-300 mb-4">Import practice items from other sources. Items will be appended to your existing items.</p>
                    <Textarea
                        value={itemsData}
                        onChange={(e) => setItemsData(e.target.value)}
                        placeholder="Paste your JSON data here..."
                        className="h-48 font-mono bg-gray-800 mb-2"
                    />
                    <p className="text-sm text-gray-400 mb-4">Expected format: Array of objects with 'title' and 'duration' fields</p>
                    <Button 
                        onClick={handleItemsImport}
                        className="bg-blue-600 hover:bg-blue-700"
                    >
                        Import Items
                    </Button>
                </div>

                <div>
                    <CardTitle className="text-2xl mb-4">Import Routine Items</CardTitle>
                    <p className="text-gray-300 mb-4">Import items into an existing routine. Items will be matched by title with existing items.</p>
                    <div className="mb-4">
                        <Label htmlFor="routine-select" className="block mb-2">Select Routine</Label>
                        <Select
                            value={selectedRoutineId}
                            onValueChange={setSelectedRoutineId}
                            disabled={routinesLoading}
                        >
                            <SelectTrigger className="w-full bg-gray-800">
                                <SelectValue placeholder="Select a routine" />
                            </SelectTrigger>
                            <SelectContent className="bg-gray-800">
                                {routines.map((routine) => (
                                    <SelectItem
                                        key={routine.ID}
                                        value={routine.ID}
                                        className="text-gray-100 hover:bg-gray-700"
                                    >
                                        {routine.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <Textarea
                        value={routineItemsData}
                        onChange={(e) => setRoutineItemsData(e.target.value)}
                        placeholder="Paste your JSON data here..."
                        className="h-48 font-mono bg-gray-800 mb-2"
                    />
                    <p className="text-sm text-gray-400 mb-4">Expected format: Array of objects with 'title' field</p>
                    <Button 
                        onClick={handleRoutineItemsImport}
                        className="bg-blue-600 hover:bg-blue-700"
                    >
                        Import Routine Items
                    </Button>
                </div>

                <div>
                    <CardTitle className="text-2xl mb-4">Import Routines</CardTitle>
                    <p className="text-gray-300 mb-4">Import practice routines. Each routine will be created as a new routine.</p>
                    <Textarea
                        value={routinesData}
                        onChange={(e) => setRoutinesData(e.target.value)}
                        placeholder="Paste your JSON data here..."
                        className="h-48 font-mono bg-gray-800 mb-2"
                    />
                    <p className="text-sm text-gray-400 mb-4">Expected format: Array of objects with 'name' field</p>
                    <Button 
                        onClick={handleRoutinesImport}
                        className="bg-blue-600 hover:bg-blue-700"
                    >
                        Import Routines
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
} 