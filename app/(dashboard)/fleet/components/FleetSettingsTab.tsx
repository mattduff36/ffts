import { Loader2, Truck, Plus, Edit, Trash2, HardHat, ChevronDown } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TabsContent } from '@/components/ui/tabs';
import { PanelLoader } from '@/components/ui/panel-loader';
import type { Category, HgvAsset, HgvCategory, PlantAsset, Vehicle } from '../types';

interface FleetSettingsTabProps {
  isAdmin: boolean;
  isManager: boolean;
  categories: Category[];
  categoriesLoading: boolean;
  vehicles: Vehicle[];
  vehiclesLoading: boolean;
  plantAssets: PlantAsset[];
  plantAssetsLoading: boolean;
  hgvCategories: HgvCategory[];
  hgvCategoriesLoading: boolean;
  hgvAssets: HgvAsset[];
  hgvAssetsLoading: boolean;
  plantCategoriesExpanded: boolean;
  vanCategoriesExpanded: boolean;
  hgvCategoriesExpanded: boolean;
  onPlantCategoriesExpandedChange: (expanded: boolean) => void;
  onVanCategoriesExpandedChange: (expanded: boolean) => void;
  onHgvCategoriesExpandedChange: (expanded: boolean) => void;
  onAddCategory: () => void;
  onEditCategory: (category: Category) => void;
  onDeleteCategory: (category: Category) => void;
  onAddHgvCategory: () => void;
  onEditHgvCategory: (category: HgvCategory) => void;
  onDeleteHgvCategory: (category: HgvCategory) => void;
}

export function FleetSettingsTab({
  isAdmin,
  isManager,
  categories,
  categoriesLoading,
  vehicles,
  vehiclesLoading,
  plantAssets,
  plantAssetsLoading,
  hgvCategories,
  hgvCategoriesLoading,
  hgvAssets,
  hgvAssetsLoading,
  plantCategoriesExpanded,
  vanCategoriesExpanded,
  hgvCategoriesExpanded,
  onPlantCategoriesExpandedChange,
  onVanCategoriesExpandedChange,
  onHgvCategoriesExpandedChange,
  onAddCategory,
  onEditCategory,
  onDeleteCategory,
  onAddHgvCategory,
  onEditHgvCategory,
  onDeleteHgvCategory,
}: FleetSettingsTabProps) {
  if (!isAdmin && !isManager) return null;

  return (
    <TabsContent value="settings" className="space-y-6 mt-0">
      {isAdmin && (
        <>
          <Card className="border-border">
            <CardHeader
              className="cursor-pointer hover:bg-slate-800/30 transition-colors"
              onClick={() => onPlantCategoriesExpandedChange(!plantCategoriesExpanded)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1">
                  <ChevronDown
                    className={`h-5 w-5 text-muted-foreground transition-transform ${
                      plantCategoriesExpanded ? 'rotate-180' : ''
                    }`}
                  />
                  <div>
                    <CardTitle className="text-white flex items-center gap-2">
                      <HardHat className="h-5 w-5" />
                      Plant Machinery Categories
                    </CardTitle>
                    <CardDescription className="text-muted-foreground">
                      {(() => {
                        const plantCategories = categories.filter(c =>
                          (c.applies_to || []).includes('plant')
                        );
                        return `${plantCategories.length} ${plantCategories.length === 1 ? 'category' : 'categories'}`;
                      })()}
                    </CardDescription>
                  </div>
                </div>
                <Button
                  size="sm"
                  className="bg-fleet hover:bg-fleet-dark"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddCategory();
                  }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Category
                </Button>
              </div>
            </CardHeader>

            {plantCategoriesExpanded && (
              <CardContent className="pt-6">
                {categoriesLoading ? (
                  <PanelLoader message="Loading plant categories..." accent="fleet" className="py-8" />
                ) : (() => {
                  const plantCategories = categories.filter(c =>
                    (c.applies_to || []).includes('plant')
                  );

                  return plantCategories.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No plant machinery categories found
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {plantCategories.map((category) => {
                        const plantCount = plantAssets.filter(p => p.category_id === category.id).length;
                        return (
                          <Card key={category.id} className="bg-slate-800/50 border-border">
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4 flex-1">
                                  <div className="bg-orange-500/10 p-3 rounded-lg">
                                    <HardHat className="h-5 w-5 text-orange-400" />
                                  </div>
                                  <div className="flex-1">
                                    <h3 className="text-lg font-semibold text-white">{category.name}</h3>
                                    <p className="text-sm text-muted-foreground mt-1">
                                      {category.description || 'No description'}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center gap-4">
                                  <div className="text-right">
                                    {plantAssetsLoading ? (
                                      <Loader2 className="h-5 w-5 animate-spin text-orange-400 ml-auto" />
                                    ) : (
                                      <div className="text-2xl font-bold text-orange-400">
                                        {plantCount}
                                      </div>
                                    )}
                                    <p className="text-xs text-muted-foreground">plant assets</p>
                                  </div>
                                  <div className="flex gap-1">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => onEditCategory(category)}
                                      className="text-blue-400 hover:text-blue-300 hover:bg-slate-800"
                                      title="Edit Category"
                                    >
                                      <Edit className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => onDeleteCategory(category)}
                                      className="text-red-400 hover:text-red-300 hover:bg-slate-800"
                                      title="Delete Category"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  );
                })()}
              </CardContent>
            )}
          </Card>

          <Card className="border-border">
            <CardHeader
              className="cursor-pointer hover:bg-slate-800/30 transition-colors"
              onClick={() => onVanCategoriesExpandedChange(!vanCategoriesExpanded)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1">
                  <ChevronDown
                    className={`h-5 w-5 text-muted-foreground transition-transform ${
                      vanCategoriesExpanded ? 'rotate-180' : ''
                    }`}
                  />
                  <div>
                    <CardTitle className="text-white flex items-center gap-2">
                      <Truck className="h-5 w-5" />
                      Van Categories
                    </CardTitle>
                    <CardDescription className="text-muted-foreground">
                      {(() => {
                        const vanCategories = categories.filter(c =>
                          (c.applies_to || ['van']).includes('van')
                        );
                        return `${vanCategories.length} ${vanCategories.length === 1 ? 'category' : 'categories'}`;
                      })()}
                    </CardDescription>
                  </div>
                </div>
                <Button
                  size="sm"
                  className="bg-fleet hover:bg-fleet-dark"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddCategory();
                  }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Category
                </Button>
              </div>
            </CardHeader>

            {vanCategoriesExpanded && (
              <CardContent className="pt-6">
                {categoriesLoading ? (
                  <PanelLoader message="Loading van categories..." accent="fleet" className="py-8" />
                ) : (() => {
                  const vanCategories = categories.filter(c => {
                    return (c.applies_to || ['van']).includes('van');
                  });

                  return vanCategories.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      No van categories found
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {vanCategories.map((category) => (
                        <Card key={category.id} className="bg-slate-800/50 border-border">
                          <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-4 flex-1">
                                <div className="bg-blue-500/10 p-3 rounded-lg">
                                  <Truck className="h-5 w-5 text-blue-400" />
                                </div>
                                <div className="flex-1">
                                  <h3 className="text-lg font-semibold text-white">{category.name}</h3>
                                  <p className="text-sm text-muted-foreground mt-1">
                                    {category.description || 'No description'}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="text-right">
                                  {vehiclesLoading ? (
                                    <Loader2 className="h-5 w-5 animate-spin text-blue-400 ml-auto" />
                                  ) : (
                                    <div className="text-2xl font-bold text-blue-400">
                                      {vehicles.filter(v => v.category_id === category.id).length}
                                    </div>
                                  )}
                                  <p className="text-xs text-muted-foreground">vans</p>
                                </div>
                                <div className="flex gap-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => onEditCategory(category)}
                                    className="text-blue-400 hover:text-blue-300 hover:bg-slate-800"
                                    title="Edit Category"
                                  >
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => onDeleteCategory(category)}
                                    className="text-red-400 hover:text-red-300 hover:bg-slate-800"
                                    title="Delete Category"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  );
                })()}
              </CardContent>
            )}
          </Card>

          <Card className="border-border">
            <CardHeader
              className="cursor-pointer hover:bg-slate-800/30 transition-colors"
              onClick={() => onHgvCategoriesExpandedChange(!hgvCategoriesExpanded)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1">
                  <ChevronDown
                    className={`h-5 w-5 text-muted-foreground transition-transform ${
                      hgvCategoriesExpanded ? 'rotate-180' : ''
                    }`}
                  />
                  <div>
                    <CardTitle className="text-white flex items-center gap-2">
                      <Truck className="h-5 w-5" />
                      HGV Categories
                    </CardTitle>
                    <CardDescription className="text-muted-foreground">
                      {`${hgvCategories.length} ${hgvCategories.length === 1 ? 'category' : 'categories'}`}
                    </CardDescription>
                  </div>
                </div>
                <Button
                  size="sm"
                  className="bg-fleet hover:bg-fleet-dark"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddHgvCategory();
                  }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Category
                </Button>
              </div>
            </CardHeader>

            {hgvCategoriesExpanded && (
              <CardContent className="pt-6">
                {hgvCategoriesLoading ? (
                  <PanelLoader message="Loading HGV categories..." accent="fleet" className="py-8" />
                ) : hgvCategories.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No HGV categories found
                  </div>
                ) : (
                  <div className="space-y-3">
                    {hgvCategories.map((category) => {
                      const hgvCount = hgvAssets.filter(h => h.category_id === category.id).length;
                      return (
                        <Card key={category.id} className="bg-slate-800/50 border-border">
                          <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-4 flex-1">
                                <div className="bg-emerald-500/10 p-3 rounded-lg">
                                  <Truck className="h-5 w-5 text-emerald-400" />
                                </div>
                                <div className="flex-1">
                                  <h3 className="text-lg font-semibold text-white">{category.name}</h3>
                                  <p className="text-sm text-muted-foreground mt-1">
                                    {category.description || 'No description'}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-4">
                                <div className="text-right">
                                  {hgvAssetsLoading ? (
                                    <Loader2 className="h-5 w-5 animate-spin text-emerald-400 ml-auto" />
                                  ) : (
                                    <div className="text-2xl font-bold text-emerald-400">{hgvCount}</div>
                                  )}
                                  <p className="text-xs text-muted-foreground">HGVs</p>
                                </div>
                                <div className="flex gap-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => onEditHgvCategory(category)}
                                    className="text-emerald-400 hover:text-emerald-300 hover:bg-slate-800"
                                    title="Edit Category"
                                  >
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => onDeleteHgvCategory(category)}
                                    className="text-red-400 hover:text-red-300 hover:bg-slate-800"
                                    title="Delete Category"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        </>
      )}
    </TabsContent>
  );
}
