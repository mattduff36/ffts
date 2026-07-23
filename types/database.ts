export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '12'
  }
  public: {
    Tables: {
      absence_allowance_carryovers: {
        Row: {
          id: string
          profile_id: string
          financial_year_start_year: number
          source_financial_year_start_year: number
          carried_days: number
          auto_generated: boolean
          generation_source: string
          generated_at: string
          generated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          financial_year_start_year: number
          source_financial_year_start_year: number
          carried_days?: number
          auto_generated?: boolean
          generation_source?: string
          generated_at?: string
          generated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          financial_year_start_year?: number
          source_financial_year_start_year?: number
          carried_days?: number
          auto_generated?: boolean
          generation_source?: string
          generated_at?: string
          generated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'absence_allowance_carryovers_generated_by_fkey'
            columns: ['generated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'absence_allowance_carryovers_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      absence_bulk_batches: {
        Row: {
          id: string
          created_by: string | null
          reason_id: string
          reason_name: string
          start_date: string
          end_date: string
          notes: string | null
          apply_to_all: boolean
          role_names: string[]
          explicit_profile_ids: string[]
          targeted_count: number
          created_count: number
          duplicate_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          created_by?: string | null
          reason_id: string
          reason_name: string
          start_date: string
          end_date: string
          notes?: string | null
          apply_to_all?: boolean
          role_names?: string[]
          explicit_profile_ids?: string[]
          targeted_count?: number
          created_count?: number
          duplicate_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          created_by?: string | null
          reason_id?: string
          reason_name?: string
          start_date?: string
          end_date?: string
          notes?: string | null
          apply_to_all?: boolean
          role_names?: string[]
          explicit_profile_ids?: string[]
          targeted_count?: number
          created_count?: number
          duplicate_count?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'absence_bulk_batches_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'absence_bulk_batches_reason_id_fkey'
            columns: ['reason_id']
            isOneToOne: false
            referencedRelation: 'absence_reasons'
            referencedColumns: ['id']
          },
        ]
      }
      absence_financial_year_archives: {
        Row: {
          id: string
          financial_year_start_year: number
          archived_at: string
          archived_by: string | null
          row_count: number
          notes: string | null
          idempotency_key: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          financial_year_start_year: number
          archived_at?: string
          archived_by?: string | null
          row_count?: number
          notes?: string | null
          idempotency_key?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          financial_year_start_year?: number
          archived_at?: string
          archived_by?: string | null
          row_count?: number
          notes?: string | null
          idempotency_key?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'absence_financial_year_archives_archived_by_fkey'
            columns: ['archived_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      absence_financial_year_close_snapshot_rows: {
        Row: {
          id: string
          snapshot_id: string
          carryover_id: string
          profile_id: string
          financial_year_start_year: number
          source_financial_year_start_year: number
          carried_days: number
          auto_generated: boolean
          generation_source: string
          generated_at: string
          generated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          snapshot_id: string
          carryover_id: string
          profile_id: string
          financial_year_start_year: number
          source_financial_year_start_year: number
          carried_days: number
          auto_generated: boolean
          generation_source: string
          generated_at: string
          generated_by?: string | null
          created_at: string
          updated_at: string
        }
        Update: {
          id?: string
          snapshot_id?: string
          carryover_id?: string
          profile_id?: string
          financial_year_start_year?: number
          source_financial_year_start_year?: number
          carried_days?: number
          auto_generated?: boolean
          generation_source?: string
          generated_at?: string
          generated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'absence_financial_year_close_snapshot_rows_generated_by_fkey'
            columns: ['generated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'absence_financial_year_close_snapshot_rows_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'absence_financial_year_close_snapshot_rows_snapshot_id_fkey'
            columns: ['snapshot_id']
            isOneToOne: false
            referencedRelation: 'absence_financial_year_close_snapshots'
            referencedColumns: ['id']
          },
        ]
      }
      absence_financial_year_close_snapshots: {
        Row: {
          id: string
          financial_year_start_year: number
          target_financial_year_start_year: number
          snapshot_taken_at: string
          snapshot_taken_by: string | null
          restored_at: string | null
          restored_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          financial_year_start_year: number
          target_financial_year_start_year: number
          snapshot_taken_at?: string
          snapshot_taken_by?: string | null
          restored_at?: string | null
          restored_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          financial_year_start_year?: number
          target_financial_year_start_year?: number
          snapshot_taken_at?: string
          snapshot_taken_by?: string | null
          restored_at?: string | null
          restored_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'absence_financial_year_close_snapshots_restored_by_fkey'
            columns: ['restored_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'absence_financial_year_close_snapshots_snapshot_taken_by_fkey'
            columns: ['snapshot_taken_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      absence_financial_year_closures: {
        Row: {
          id: string
          financial_year_start_year: number
          closed_at: string
          closed_by: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          financial_year_start_year: number
          closed_at?: string
          closed_by?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          financial_year_start_year?: number
          closed_at?: string
          closed_by?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'absence_financial_year_closures_closed_by_fkey'
            columns: ['closed_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      absence_financial_year_generations: {
        Row: {
          id: string
          financial_year_start_year: number
          generated_at: string
          generated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          financial_year_start_year: number
          generated_at?: string
          generated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          financial_year_start_year?: number
          generated_at?: string
          generated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'absence_financial_year_generations_generated_by_fkey'
            columns: ['generated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      absence_module_settings: {
        Row: {
          id: boolean
          announcement_message: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: boolean
          announcement_message?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: boolean
          announcement_message?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      absence_reasons: {
        Row: {
          id: string
          name: string
          is_paid: boolean
          is_active: boolean
          created_at: string | null
          updated_at: string | null
          color: string
        }
        Insert: {
          id?: string
          name: string
          is_paid?: boolean
          is_active?: boolean
          created_at?: string | null
          updated_at?: string | null
          color?: string
        }
        Update: {
          id?: string
          name?: string
          is_paid?: boolean
          is_active?: boolean
          created_at?: string | null
          updated_at?: string | null
          color?: string
        }
        Relationships: [
        ]
      }
      absence_secondary_permission_exceptions: {
        Row: {
          profile_id: string
          see_bookings_all: boolean | null
          see_bookings_team: boolean | null
          see_bookings_own: boolean | null
          add_edit_bookings_all: boolean | null
          add_edit_bookings_team: boolean | null
          add_edit_bookings_own: boolean | null
          see_allowances_all: boolean | null
          see_allowances_team: boolean | null
          add_edit_allowances_all: boolean | null
          add_edit_allowances_team: boolean | null
          authorise_bookings_all: boolean | null
          authorise_bookings_team: boolean | null
          authorise_bookings_own: boolean | null
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
          see_manage_overview: boolean | null
          see_manage_reasons: boolean | null
          see_manage_work_shifts: boolean | null
          edit_manage_work_shifts: boolean | null
          see_manage_overview_all: boolean | null
          see_manage_overview_team: boolean | null
          see_manage_work_shifts_all: boolean | null
          see_manage_work_shifts_team: boolean | null
          edit_manage_work_shifts_all: boolean | null
          edit_manage_work_shifts_team: boolean | null
        }
        Insert: {
          profile_id: string
          see_bookings_all?: boolean | null
          see_bookings_team?: boolean | null
          see_bookings_own?: boolean | null
          add_edit_bookings_all?: boolean | null
          add_edit_bookings_team?: boolean | null
          add_edit_bookings_own?: boolean | null
          see_allowances_all?: boolean | null
          see_allowances_team?: boolean | null
          add_edit_allowances_all?: boolean | null
          add_edit_allowances_team?: boolean | null
          authorise_bookings_all?: boolean | null
          authorise_bookings_team?: boolean | null
          authorise_bookings_own?: boolean | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
          see_manage_overview?: boolean | null
          see_manage_reasons?: boolean | null
          see_manage_work_shifts?: boolean | null
          edit_manage_work_shifts?: boolean | null
          see_manage_overview_all?: boolean | null
          see_manage_overview_team?: boolean | null
          see_manage_work_shifts_all?: boolean | null
          see_manage_work_shifts_team?: boolean | null
          edit_manage_work_shifts_all?: boolean | null
          edit_manage_work_shifts_team?: boolean | null
        }
        Update: {
          profile_id?: string
          see_bookings_all?: boolean | null
          see_bookings_team?: boolean | null
          see_bookings_own?: boolean | null
          add_edit_bookings_all?: boolean | null
          add_edit_bookings_team?: boolean | null
          add_edit_bookings_own?: boolean | null
          see_allowances_all?: boolean | null
          see_allowances_team?: boolean | null
          add_edit_allowances_all?: boolean | null
          add_edit_allowances_team?: boolean | null
          authorise_bookings_all?: boolean | null
          authorise_bookings_team?: boolean | null
          authorise_bookings_own?: boolean | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
          see_manage_overview?: boolean | null
          see_manage_reasons?: boolean | null
          see_manage_work_shifts?: boolean | null
          edit_manage_work_shifts?: boolean | null
          see_manage_overview_all?: boolean | null
          see_manage_overview_team?: boolean | null
          see_manage_work_shifts_all?: boolean | null
          see_manage_work_shifts_team?: boolean | null
          edit_manage_work_shifts_all?: boolean | null
          edit_manage_work_shifts_team?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: 'absence_secondary_permission_exceptions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'absence_secondary_permission_exceptions_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'absence_secondary_permission_exceptions_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      absences: {
        Row: {
          id: string
          profile_id: string
          date: string
          end_date: string | null
          reason_id: string
          duration_days: number
          is_half_day: boolean | null
          half_day_session: 'AM' | 'PM' | null
          notes: string | null
          status: 'pending' | 'approved' | 'processed' | 'rejected' | 'cancelled'
          created_by: string | null
          approved_by: string | null
          approved_at: string | null
          created_at: string | null
          updated_at: string | null
          is_bank_holiday: boolean
          auto_generated: boolean
          generation_source: string | null
          holiday_key: string | null
          bulk_batch_id: string | null
          allow_timesheet_work_on_leave: boolean
          processed_by: string | null
          processed_at: string | null
        }
        Insert: {
          id?: string
          profile_id: string
          date: string
          end_date?: string | null
          reason_id: string
          duration_days: number
          is_half_day?: boolean | null
          half_day_session?: 'AM' | 'PM' | null
          notes?: string | null
          status?: 'pending' | 'approved' | 'processed' | 'rejected' | 'cancelled'
          created_by?: string | null
          approved_by?: string | null
          approved_at?: string | null
          created_at?: string | null
          updated_at?: string | null
          is_bank_holiday?: boolean
          auto_generated?: boolean
          generation_source?: string | null
          holiday_key?: string | null
          bulk_batch_id?: string | null
          allow_timesheet_work_on_leave?: boolean
          processed_by?: string | null
          processed_at?: string | null
        }
        Update: {
          id?: string
          profile_id?: string
          date?: string
          end_date?: string | null
          reason_id?: string
          duration_days?: number
          is_half_day?: boolean | null
          half_day_session?: 'AM' | 'PM' | null
          notes?: string | null
          status?: 'pending' | 'approved' | 'processed' | 'rejected' | 'cancelled'
          created_by?: string | null
          approved_by?: string | null
          approved_at?: string | null
          created_at?: string | null
          updated_at?: string | null
          is_bank_holiday?: boolean
          auto_generated?: boolean
          generation_source?: string | null
          holiday_key?: string | null
          bulk_batch_id?: string | null
          allow_timesheet_work_on_leave?: boolean
          processed_by?: string | null
          processed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'absences_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'absences_bulk_batch_id_fkey'
            columns: ['bulk_batch_id']
            isOneToOne: false
            referencedRelation: 'absence_bulk_batches'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'absences_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'absences_processed_by_fkey'
            columns: ['processed_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'absences_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'absences_reason_id_fkey'
            columns: ['reason_id']
            isOneToOne: false
            referencedRelation: 'absence_reasons'
            referencedColumns: ['id']
          },
        ]
      }
      absences_archive: {
        Row: {
          id: string
          profile_id: string
          date: string
          end_date: string | null
          reason_id: string
          duration_days: number
          is_half_day: boolean
          half_day_session: 'AM' | 'PM' | null
          notes: string | null
          status: 'pending' | 'approved' | 'processed' | 'rejected' | 'cancelled'
          created_by: string | null
          approved_by: string | null
          approved_at: string | null
          is_bank_holiday: boolean
          auto_generated: boolean
          generation_source: string | null
          holiday_key: string | null
          created_at: string
          updated_at: string
          financial_year_start_year: number
          archived_at: string
          archived_by: string | null
          archive_run_id: string | null
          allow_timesheet_work_on_leave: boolean
          processed_by: string | null
          processed_at: string | null
        }
        Insert: {
          id: string
          profile_id: string
          date: string
          end_date?: string | null
          reason_id: string
          duration_days: number
          is_half_day?: boolean
          half_day_session?: 'AM' | 'PM' | null
          notes?: string | null
          status: 'pending' | 'approved' | 'processed' | 'rejected' | 'cancelled'
          created_by?: string | null
          approved_by?: string | null
          approved_at?: string | null
          is_bank_holiday?: boolean
          auto_generated?: boolean
          generation_source?: string | null
          holiday_key?: string | null
          created_at: string
          updated_at: string
          financial_year_start_year: number
          archived_at?: string
          archived_by?: string | null
          archive_run_id?: string | null
          allow_timesheet_work_on_leave?: boolean
          processed_by?: string | null
          processed_at?: string | null
        }
        Update: {
          id?: string
          profile_id?: string
          date?: string
          end_date?: string | null
          reason_id?: string
          duration_days?: number
          is_half_day?: boolean
          half_day_session?: 'AM' | 'PM' | null
          notes?: string | null
          status?: 'pending' | 'approved' | 'processed' | 'rejected' | 'cancelled'
          created_by?: string | null
          approved_by?: string | null
          approved_at?: string | null
          is_bank_holiday?: boolean
          auto_generated?: boolean
          generation_source?: string | null
          holiday_key?: string | null
          created_at?: string
          updated_at?: string
          financial_year_start_year?: number
          archived_at?: string
          archived_by?: string | null
          archive_run_id?: string | null
          allow_timesheet_work_on_leave?: boolean
          processed_by?: string | null
          processed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'absences_archive_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'absences_archive_archived_by_fkey'
            columns: ['archived_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'absences_archive_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'absences_archive_processed_by_fkey'
            columns: ['processed_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'absences_archive_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'absences_archive_reason_id_fkey'
            columns: ['reason_id']
            isOneToOne: false
            referencedRelation: 'absence_reasons'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fk_absences_archive_run_id'
            columns: ['archive_run_id']
            isOneToOne: false
            referencedRelation: 'absence_financial_year_archives'
            referencedColumns: ['id']
          },
        ]
      }
      actions: {
        Row: {
          id: string
          inspection_id: string | null
          inspection_item_id: string | null
          title: string
          description: string | null
          priority: 'low' | 'medium' | 'high' | 'urgent' | null
          status: 'pending' | 'in_progress' | 'logged' | 'on_hold' | 'completed' | null
          actioned: boolean
          actioned_at: string | null
          actioned_by: string | null
          created_by: string
          created_at: string | null
          updated_at: string | null
          logged_comment: string | null
          logged_at: string | null
          logged_by: string | null
          action_type: 'inspection_defect' | 'workshop_vehicle_task' | 'manager_action'
          van_id: string | null
          workshop_category_id: string | null
          workshop_comments: string | null
          actioned_comment: string | null
          workshop_subcategory_id: string | null
          status_history: Json | null
          plant_id: string | null
          hgv_id: string | null
          actioned_signature_data: string | null
          actioned_signed_at: string | null
          asset_meter_reading: number | null
          asset_meter_unit: string | null
        }
        Insert: {
          id?: string
          inspection_id?: string | null
          inspection_item_id?: string | null
          title: string
          description?: string | null
          priority?: 'low' | 'medium' | 'high' | 'urgent' | null
          status?: 'pending' | 'in_progress' | 'logged' | 'on_hold' | 'completed' | null
          actioned?: boolean
          actioned_at?: string | null
          actioned_by?: string | null
          created_by: string
          created_at?: string | null
          updated_at?: string | null
          logged_comment?: string | null
          logged_at?: string | null
          logged_by?: string | null
          action_type?: 'inspection_defect' | 'workshop_vehicle_task' | 'manager_action'
          van_id?: string | null
          workshop_category_id?: string | null
          workshop_comments?: string | null
          actioned_comment?: string | null
          workshop_subcategory_id?: string | null
          status_history?: Json | null
          plant_id?: string | null
          hgv_id?: string | null
          actioned_signature_data?: string | null
          actioned_signed_at?: string | null
          asset_meter_reading?: number | null
          asset_meter_unit?: string | null
        }
        Update: {
          id?: string
          inspection_id?: string | null
          inspection_item_id?: string | null
          title?: string
          description?: string | null
          priority?: 'low' | 'medium' | 'high' | 'urgent' | null
          status?: 'pending' | 'in_progress' | 'logged' | 'on_hold' | 'completed' | null
          actioned?: boolean
          actioned_at?: string | null
          actioned_by?: string | null
          created_by?: string
          created_at?: string | null
          updated_at?: string | null
          logged_comment?: string | null
          logged_at?: string | null
          logged_by?: string | null
          action_type?: 'inspection_defect' | 'workshop_vehicle_task' | 'manager_action'
          van_id?: string | null
          workshop_category_id?: string | null
          workshop_comments?: string | null
          actioned_comment?: string | null
          workshop_subcategory_id?: string | null
          status_history?: Json | null
          plant_id?: string | null
          hgv_id?: string | null
          actioned_signature_data?: string | null
          actioned_signed_at?: string | null
          asset_meter_reading?: number | null
          asset_meter_unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'actions_hgv_id_fkey'
            columns: ['hgv_id']
            isOneToOne: false
            referencedRelation: 'hgvs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'actions_inspection_item_id_fkey'
            columns: ['inspection_item_id']
            isOneToOne: false
            referencedRelation: 'inspection_items'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'actions_plant_id_fkey'
            columns: ['plant_id']
            isOneToOne: false
            referencedRelation: 'plant'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'actions_van_id_fkey'
            columns: ['van_id']
            isOneToOne: false
            referencedRelation: 'vans'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'actions_workshop_category_id_fkey'
            columns: ['workshop_category_id']
            isOneToOne: false
            referencedRelation: 'workshop_task_categories'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'actions_workshop_subcategory_id_fkey'
            columns: ['workshop_subcategory_id']
            isOneToOne: false
            referencedRelation: 'workshop_task_subcategories'
            referencedColumns: ['id']
          },
        ]
      }
      admin_error_notification_prefs: {
        Row: {
          user_id: string
          notify_in_app: boolean | null
          notify_email: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          user_id: string
          notify_in_app?: boolean | null
          notify_email?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          user_id?: string
          notify_in_app?: boolean | null
          notify_email?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'admin_error_notification_prefs_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      app_auth_sessions: {
        Row: {
          id: string
          profile_id: string
          device_id: string | null
          session_secret_hash: string
          session_source: 'password_login' | 'session_bootstrap' | 'biometric_login'
          remember_me: boolean
          last_seen_at: string
          idle_expires_at: string
          absolute_expires_at: string
          revoked_at: string | null
          revoked_reason: string | null
          replaced_by_session_id: string | null
          user_agent: string | null
          ip_hash: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          device_id?: string | null
          session_secret_hash: string
          session_source: 'password_login' | 'session_bootstrap' | 'biometric_login'
          remember_me?: boolean
          last_seen_at?: string
          idle_expires_at: string
          absolute_expires_at: string
          revoked_at?: string | null
          revoked_reason?: string | null
          replaced_by_session_id?: string | null
          user_agent?: string | null
          ip_hash?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          device_id?: string | null
          session_secret_hash?: string
          session_source?: 'password_login' | 'session_bootstrap' | 'biometric_login'
          remember_me?: boolean
          last_seen_at?: string
          idle_expires_at?: string
          absolute_expires_at?: string
          revoked_at?: string | null
          revoked_reason?: string | null
          replaced_by_session_id?: string | null
          user_agent?: string | null
          ip_hash?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'app_auth_sessions_device_id_fkey'
            columns: ['device_id']
            isOneToOne: false
            referencedRelation: 'webauthn_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'app_auth_sessions_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'app_auth_sessions_replaced_by_session_id_fkey'
            columns: ['replaced_by_session_id']
            isOneToOne: false
            referencedRelation: 'app_auth_sessions'
            referencedColumns: ['id']
          },
        ]
      }
      asset_maintenance_category_values: {
        Row: {
          id: string
          maintenance_category_id: string
          van_id: string | null
          hgv_id: string | null
          plant_id: string | null
          due_date: string | null
          due_mileage: number | null
          last_mileage: number | null
          due_hours: number | null
          last_hours: number | null
          notes: string | null
          last_updated_by: string | null
          last_updated_at: string
          created_at: string
          updated_at: string
          asset_type: string | null
          asset_id: string | null
        }
        Insert: {
          id?: string
          maintenance_category_id: string
          van_id?: string | null
          hgv_id?: string | null
          plant_id?: string | null
          due_date?: string | null
          due_mileage?: number | null
          last_mileage?: number | null
          due_hours?: number | null
          last_hours?: number | null
          notes?: string | null
          last_updated_by?: string | null
          last_updated_at?: string
          created_at?: string
          updated_at?: string
          asset_type?: never
          asset_id?: never
        }
        Update: {
          id?: string
          maintenance_category_id?: string
          van_id?: string | null
          hgv_id?: string | null
          plant_id?: string | null
          due_date?: string | null
          due_mileage?: number | null
          last_mileage?: number | null
          due_hours?: number | null
          last_hours?: number | null
          notes?: string | null
          last_updated_by?: string | null
          last_updated_at?: string
          created_at?: string
          updated_at?: string
          asset_type?: never
          asset_id?: never
        }
        Relationships: [
          {
            foreignKeyName: 'asset_maintenance_category_values_hgv_id_fkey'
            columns: ['hgv_id']
            isOneToOne: false
            referencedRelation: 'hgvs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'asset_maintenance_category_values_last_updated_by_fkey'
            columns: ['last_updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'asset_maintenance_category_values_maintenance_category_id_fkey'
            columns: ['maintenance_category_id']
            isOneToOne: false
            referencedRelation: 'maintenance_categories'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'asset_maintenance_category_values_plant_id_fkey'
            columns: ['plant_id']
            isOneToOne: false
            referencedRelation: 'plant'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'asset_maintenance_category_values_van_id_fkey'
            columns: ['van_id']
            isOneToOne: false
            referencedRelation: 'vans'
            referencedColumns: ['id']
          },
        ]
      }
      audit_log: {
        Row: {
          id: string
          table_name: string
          record_id: string
          user_id: string | null
          action: string
          changes: Json | null
          created_at: string | null
        }
        Insert: {
          id?: string
          table_name: string
          record_id: string
          user_id?: string | null
          action: string
          changes?: Json | null
          created_at?: string | null
        }
        Update: {
          id?: string
          table_name?: string
          record_id?: string
          user_id?: string | null
          action?: string
          changes?: Json | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'audit_log_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      customer_contacts: {
        Row: {
          id: string
          customer_id: string
          name: string | null
          job_title: string | null
          email: string | null
          phone: string | null
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
        }
        Insert: {
          id?: string
          customer_id: string
          name?: string | null
          job_title?: string | null
          email?: string | null
          phone?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Update: {
          id?: string
          customer_id?: string
          name?: string | null
          job_title?: string | null
          email?: string | null
          phone?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'customer_contacts_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'customer_contacts_customer_id_fkey'
            columns: ['customer_id']
            isOneToOne: false
            referencedRelation: 'customers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'customer_contacts_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      customer_sites: {
        Row: {
          id: string
          customer_id: string
          site_name: string
          address_line_1: string | null
          address_line_2: string | null
          city: string | null
          county: string | null
          postcode: string | null
          is_active: boolean
          is_default: boolean
          notes: string | null
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          customer_id: string
          site_name: string
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          county?: string | null
          postcode?: string | null
          is_active?: boolean
          is_default?: boolean
          notes?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          customer_id?: string
          site_name?: string
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          county?: string | null
          postcode?: string | null
          is_active?: boolean
          is_default?: boolean
          notes?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'customer_sites_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'customer_sites_customer_id_fkey'
            columns: ['customer_id']
            isOneToOne: false
            referencedRelation: 'customers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'customer_sites_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      customers: {
        Row: {
          id: string
          company_name: string
          short_name: string | null
          contact_name: string | null
          contact_email: string | null
          contact_phone: string | null
          contact_job_title: string | null
          address_line_1: string | null
          address_line_2: string | null
          city: string | null
          county: string | null
          postcode: string | null
          payment_terms_days: number | null
          default_validity_days: number | null
          status: 'active' | 'inactive' | null
          notes: string | null
          created_at: string | null
          updated_at: string | null
          created_by: string | null
          updated_by: string | null
        }
        Insert: {
          id?: string
          company_name: string
          short_name?: string | null
          contact_name?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          contact_job_title?: string | null
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          county?: string | null
          postcode?: string | null
          payment_terms_days?: number | null
          default_validity_days?: number | null
          status?: 'active' | 'inactive' | null
          notes?: string | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
          updated_by?: string | null
        }
        Update: {
          id?: string
          company_name?: string
          short_name?: string | null
          contact_name?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          contact_job_title?: string | null
          address_line_1?: string | null
          address_line_2?: string | null
          city?: string | null
          county?: string | null
          postcode?: string | null
          payment_terms_days?: number | null
          default_validity_days?: number | null
          status?: 'active' | 'inactive' | null
          notes?: string | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'customers_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'customers_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      display_board_configs: {
        Row: {
          board_key: string
          name: string
          fallback_poll_interval_seconds: number
          realtime_debounce_ms: number
          is_enabled: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          board_key: string
          name: string
          fallback_poll_interval_seconds?: number
          realtime_debounce_ms?: number
          is_enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          board_key?: string
          name?: string
          fallback_poll_interval_seconds?: number
          realtime_debounce_ms?: number
          is_enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      display_board_devices: {
        Row: {
          id: string
          board_key: string
          device_token_hash: string
          label: string | null
          paired_by: string | null
          pairing_session_id: string | null
          last_seen_at: string | null
          revoked_at: string | null
          revoked_by: string | null
          created_at: string
          updated_at: string
          display_text_size_step: number
        }
        Insert: {
          id?: string
          board_key: string
          device_token_hash: string
          label?: string | null
          paired_by?: string | null
          pairing_session_id?: string | null
          last_seen_at?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          created_at?: string
          updated_at?: string
          display_text_size_step?: number
        }
        Update: {
          id?: string
          board_key?: string
          device_token_hash?: string
          label?: string | null
          paired_by?: string | null
          pairing_session_id?: string | null
          last_seen_at?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          created_at?: string
          updated_at?: string
          display_text_size_step?: number
        }
        Relationships: [
          {
            foreignKeyName: 'display_board_devices_board_key_fkey'
            columns: ['board_key']
            isOneToOne: false
            referencedRelation: 'display_board_configs'
            referencedColumns: ['board_key']
          },
          {
            foreignKeyName: 'display_board_devices_paired_by_fkey'
            columns: ['paired_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'display_board_devices_pairing_session_id_fkey'
            columns: ['pairing_session_id']
            isOneToOne: false
            referencedRelation: 'display_board_pairing_sessions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'display_board_devices_revoked_by_fkey'
            columns: ['revoked_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      display_board_pairing_sessions: {
        Row: {
          id: string
          board_key: string
          confirmation_code: string | null
          confirmation_code_hash: string | null
          pairing_token_hash: string | null
          status: 'active' | 'confirmed' | 'cancelled' | 'expired'
          started_by: string | null
          confirmed_by: string | null
          candidate_seen_at: string | null
          confirmed_at: string | null
          expires_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          board_key: string
          confirmation_code?: string | null
          confirmation_code_hash?: string | null
          pairing_token_hash?: string | null
          status?: 'active' | 'confirmed' | 'cancelled' | 'expired'
          started_by?: string | null
          confirmed_by?: string | null
          candidate_seen_at?: string | null
          confirmed_at?: string | null
          expires_at: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          board_key?: string
          confirmation_code?: string | null
          confirmation_code_hash?: string | null
          pairing_token_hash?: string | null
          status?: 'active' | 'confirmed' | 'cancelled' | 'expired'
          started_by?: string | null
          confirmed_by?: string | null
          candidate_seen_at?: string | null
          confirmed_at?: string | null
          expires_at?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'display_board_pairing_sessions_board_key_fkey'
            columns: ['board_key']
            isOneToOne: false
            referencedRelation: 'display_board_configs'
            referencedColumns: ['board_key']
          },
          {
            foreignKeyName: 'display_board_pairing_sessions_confirmed_by_fkey'
            columns: ['confirmed_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'display_board_pairing_sessions_started_by_fkey'
            columns: ['started_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      dvla_sync_log: {
        Row: {
          id: string
          van_id: string | null
          registration_number: string
          sync_status: 'success' | 'error'
          error_message: string | null
          fields_updated: string[] | null
          tax_due_date_old: string | null
          tax_due_date_new: string | null
          mot_due_date_old: string | null
          mot_due_date_new: string | null
          api_provider: string | null
          api_response_time_ms: number | null
          raw_response: Json | null
          triggered_by: string | null
          trigger_type: 'manual' | 'bulk' | 'automatic' | 'auto_on_create' | null
          created_at: string | null
          hgv_id: string | null
          plant_id: string | null
        }
        Insert: {
          id?: string
          van_id?: string | null
          registration_number: string
          sync_status: 'success' | 'error'
          error_message?: string | null
          fields_updated?: string[] | null
          tax_due_date_old?: string | null
          tax_due_date_new?: string | null
          mot_due_date_old?: string | null
          mot_due_date_new?: string | null
          api_provider?: string | null
          api_response_time_ms?: number | null
          raw_response?: Json | null
          triggered_by?: string | null
          trigger_type?: 'manual' | 'bulk' | 'automatic' | 'auto_on_create' | null
          created_at?: string | null
          hgv_id?: string | null
          plant_id?: string | null
        }
        Update: {
          id?: string
          van_id?: string | null
          registration_number?: string
          sync_status?: 'success' | 'error'
          error_message?: string | null
          fields_updated?: string[] | null
          tax_due_date_old?: string | null
          tax_due_date_new?: string | null
          mot_due_date_old?: string | null
          mot_due_date_new?: string | null
          api_provider?: string | null
          api_response_time_ms?: number | null
          raw_response?: Json | null
          triggered_by?: string | null
          trigger_type?: 'manual' | 'bulk' | 'automatic' | 'auto_on_create' | null
          created_at?: string | null
          hgv_id?: string | null
          plant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'dvla_sync_log_hgv_id_fkey'
            columns: ['hgv_id']
            isOneToOne: false
            referencedRelation: 'hgvs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'dvla_sync_log_plant_id_fkey'
            columns: ['plant_id']
            isOneToOne: false
            referencedRelation: 'plant'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'dvla_sync_log_triggered_by_fkey'
            columns: ['triggered_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'dvla_sync_log_van_id_fkey'
            columns: ['van_id']
            isOneToOne: false
            referencedRelation: 'vans'
            referencedColumns: ['id']
          },
        ]
      }
      employee_work_shifts: {
        Row: {
          id: string
          profile_id: string
          template_id: string | null
          monday_am: boolean
          monday_pm: boolean
          tuesday_am: boolean
          tuesday_pm: boolean
          wednesday_am: boolean
          wednesday_pm: boolean
          thursday_am: boolean
          thursday_pm: boolean
          friday_am: boolean
          friday_pm: boolean
          saturday_am: boolean
          saturday_pm: boolean
          sunday_am: boolean
          sunday_pm: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          template_id?: string | null
          monday_am?: boolean
          monday_pm?: boolean
          tuesday_am?: boolean
          tuesday_pm?: boolean
          wednesday_am?: boolean
          wednesday_pm?: boolean
          thursday_am?: boolean
          thursday_pm?: boolean
          friday_am?: boolean
          friday_pm?: boolean
          saturday_am?: boolean
          saturday_pm?: boolean
          sunday_am?: boolean
          sunday_pm?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          template_id?: string | null
          monday_am?: boolean
          monday_pm?: boolean
          tuesday_am?: boolean
          tuesday_pm?: boolean
          wednesday_am?: boolean
          wednesday_pm?: boolean
          thursday_am?: boolean
          thursday_pm?: boolean
          friday_am?: boolean
          friday_pm?: boolean
          saturday_am?: boolean
          saturday_pm?: boolean
          sunday_am?: boolean
          sunday_pm?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'employee_work_shifts_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'employee_work_shifts_template_id_fkey'
            columns: ['template_id']
            isOneToOne: false
            referencedRelation: 'work_shift_templates'
            referencedColumns: ['id']
          },
        ]
      }
      error_log_alerts: {
        Row: {
          error_log_id: string
          notified_at: string | null
          message_id: string | null
          admin_count: number | null
          created_at: string | null
        }
        Insert: {
          error_log_id: string
          notified_at?: string | null
          message_id?: string | null
          admin_count?: number | null
          created_at?: string | null
        }
        Update: {
          error_log_id?: string
          notified_at?: string | null
          message_id?: string | null
          admin_count?: number | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'error_log_alerts_error_log_id_fkey'
            columns: ['error_log_id']
            isOneToOne: false
            referencedRelation: 'error_logs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'error_log_alerts_message_id_fkey'
            columns: ['message_id']
            isOneToOne: false
            referencedRelation: 'messages'
            referencedColumns: ['id']
          },
        ]
      }
      error_logs: {
        Row: {
          id: string
          timestamp: string
          error_message: string
          error_stack: string | null
          error_type: string
          user_id: string | null
          user_email: string | null
          page_url: string
          user_agent: string
          component_name: string | null
          additional_data: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          timestamp?: string
          error_message: string
          error_stack?: string | null
          error_type: string
          user_id?: string | null
          user_email?: string | null
          page_url: string
          user_agent: string
          component_name?: string | null
          additional_data?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          timestamp?: string
          error_message?: string
          error_stack?: string | null
          error_type?: string
          user_id?: string | null
          user_email?: string | null
          page_url?: string
          user_agent?: string
          component_name?: string | null
          additional_data?: Json | null
          created_at?: string
        }
        Relationships: [
        ]
      }
      error_report_updates: {
        Row: {
          id: string
          error_report_id: string
          created_by: string
          old_status: string | null
          new_status: string | null
          note: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          error_report_id: string
          created_by: string
          old_status?: string | null
          new_status?: string | null
          note?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          error_report_id?: string
          created_by?: string
          old_status?: string | null
          new_status?: string | null
          note?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'error_report_updates_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'error_report_updates_error_report_id_fkey'
            columns: ['error_report_id']
            isOneToOne: false
            referencedRelation: 'error_reports'
            referencedColumns: ['id']
          },
        ]
      }
      error_reports: {
        Row: {
          id: string
          created_by: string
          title: string
          description: string
          error_code: string | null
          page_url: string | null
          user_agent: string | null
          additional_context: Json | null
          status: 'new' | 'investigating' | 'resolved' | null
          admin_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          notification_message_id: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          created_by: string
          title: string
          description: string
          error_code?: string | null
          page_url?: string | null
          user_agent?: string | null
          additional_context?: Json | null
          status?: 'new' | 'investigating' | 'resolved' | null
          admin_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          notification_message_id?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          created_by?: string
          title?: string
          description?: string
          error_code?: string | null
          page_url?: string | null
          user_agent?: string | null
          additional_context?: Json | null
          status?: 'new' | 'investigating' | 'resolved' | null
          admin_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          notification_message_id?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'error_reports_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'error_reports_notification_message_id_fkey'
            columns: ['notification_message_id']
            isOneToOne: false
            referencedRelation: 'messages'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'error_reports_resolved_by_fkey'
            columns: ['resolved_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      faq_articles: {
        Row: {
          id: string
          category_id: string
          title: string
          slug: string
          summary: string | null
          content_md: string
          is_published: boolean | null
          admin_only: boolean
          sort_order: number | null
          view_count: number | null
          created_at: string | null
          updated_at: string | null
          created_by: string | null
          updated_by: string | null
        }
        Insert: {
          id?: string
          category_id: string
          title: string
          slug: string
          summary?: string | null
          content_md: string
          is_published?: boolean | null
          admin_only?: boolean
          sort_order?: number | null
          view_count?: number | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
          updated_by?: string | null
        }
        Update: {
          id?: string
          category_id?: string
          title?: string
          slug?: string
          summary?: string | null
          content_md?: string
          is_published?: boolean | null
          admin_only?: boolean
          sort_order?: number | null
          view_count?: number | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'faq_articles_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'faq_categories'
            referencedColumns: ['id']
          },
        ]
      }
      faq_categories: {
        Row: {
          id: string
          name: string
          slug: string
          description: string | null
          sort_order: number | null
          is_active: boolean | null
          created_at: string | null
          updated_at: string | null
          module_name: string | null
        }
        Insert: {
          id?: string
          name: string
          slug: string
          description?: string | null
          sort_order?: number | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
          module_name?: string | null
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          description?: string | null
          sort_order?: number | null
          is_active?: boolean | null
          created_at?: string | null
          updated_at?: string | null
          module_name?: string | null
        }
        Relationships: [
        ]
      }
      hgv_categories: {
        Row: {
          id: string
          name: string
          description: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      hgv_inspections: {
        Row: {
          id: string
          hgv_id: string | null
          user_id: string
          inspection_date: string
          inspection_end_date: string | null
          current_mileage: number | null
          status: 'draft' | 'submitted'
          submitted_at: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          manager_comments: string | null
          inspector_comments: string | null
          signature_data: string | null
          signed_at: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          hgv_id?: string | null
          user_id: string
          inspection_date: string
          inspection_end_date?: string | null
          current_mileage?: number | null
          status?: 'draft' | 'submitted'
          submitted_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          manager_comments?: string | null
          inspector_comments?: string | null
          signature_data?: string | null
          signed_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          hgv_id?: string | null
          user_id?: string
          inspection_date?: string
          inspection_end_date?: string | null
          current_mileage?: number | null
          status?: 'draft' | 'submitted'
          submitted_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          manager_comments?: string | null
          inspector_comments?: string | null
          signature_data?: string | null
          signed_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'hgv_inspections_hgv_id_fkey'
            columns: ['hgv_id']
            isOneToOne: false
            referencedRelation: 'hgvs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'hgv_inspections_reviewed_by_fkey'
            columns: ['reviewed_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'hgv_inspections_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      hgvs: {
        Row: {
          id: string
          reg_number: string
          category_id: string
          status: string
          nickname: string | null
          created_at: string | null
          current_mileage: number | null
          retired_at: string | null
          retire_reason: string | null
        }
        Insert: {
          id?: string
          reg_number: string
          category_id: string
          status?: string
          nickname?: string | null
          created_at?: string | null
          current_mileage?: number | null
          retired_at?: string | null
          retire_reason?: string | null
        }
        Update: {
          id?: string
          reg_number?: string
          category_id?: string
          status?: string
          nickname?: string | null
          created_at?: string | null
          current_mileage?: number | null
          retired_at?: string | null
          retire_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'hgvs_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'hgv_categories'
            referencedColumns: ['id']
          },
        ]
      }
      inspection_daily_hours: {
        Row: {
          id: string
          inspection_id: string
          day_of_week: number
          hours: number | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          inspection_id: string
          day_of_week: number
          hours?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          inspection_id?: string
          day_of_week?: number
          hours?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      inspection_items: {
        Row: {
          id: string
          inspection_id: string
          item_number: number
          item_description: string | null
          status: 'ok' | 'attention' | 'defect' | 'na'
          comments: string | null
          created_at: string | null
          day_of_week: number
        }
        Insert: {
          id?: string
          inspection_id: string
          item_number: number
          item_description?: string | null
          status?: 'ok' | 'attention' | 'defect' | 'na'
          comments?: string | null
          created_at?: string | null
          day_of_week: number
        }
        Update: {
          id?: string
          inspection_id?: string
          item_number?: number
          item_description?: string | null
          status?: 'ok' | 'attention' | 'defect' | 'na'
          comments?: string | null
          created_at?: string | null
          day_of_week?: number
        }
        Relationships: [
        ]
      }
      inspection_orphan_children_archive: {
        Row: {
          id: string
          child_table: 'inspection_items' | 'inspection_photos'
          child_id: string
          inspection_id: string
          row_snapshot: Json
          archived_reason: string
          archived_at: string
        }
        Insert: {
          id?: string
          child_table: 'inspection_items' | 'inspection_photos'
          child_id: string
          inspection_id: string
          row_snapshot: Json
          archived_reason?: string
          archived_at?: string
        }
        Update: {
          id?: string
          child_table?: 'inspection_items' | 'inspection_photos'
          child_id?: string
          inspection_id?: string
          row_snapshot?: Json
          archived_reason?: string
          archived_at?: string
        }
        Relationships: [
        ]
      }
      inspection_photos: {
        Row: {
          id: string
          inspection_id: string
          item_number: number | null
          day_of_week: number | null
          photo_url: string
          caption: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          inspection_id: string
          item_number?: number | null
          day_of_week?: number | null
          photo_url: string
          caption?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          inspection_id?: string
          item_number?: number | null
          day_of_week?: number | null
          photo_url?: string
          caption?: string | null
          created_at?: string | null
        }
        Relationships: [
        ]
      }
      inventory_check_history: {
        Row: {
          id: string
          item_id: string
          checked_at: string
          interval_days: number
          note: string | null
          checked_by: string | null
          created_at: string
          checklist_version: string | null
          checklist_items: Json | null
          overall_status: string | null
        }
        Insert: {
          id?: string
          item_id: string
          checked_at: string
          interval_days?: number
          note?: string | null
          checked_by?: string | null
          created_at?: string
          checklist_version?: string | null
          checklist_items?: Json | null
          overall_status?: string | null
        }
        Update: {
          id?: string
          item_id?: string
          checked_at?: string
          interval_days?: number
          note?: string | null
          checked_by?: string | null
          created_at?: string
          checklist_version?: string | null
          checklist_items?: Json | null
          overall_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'inventory_check_history_checked_by_fkey'
            columns: ['checked_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_check_history_item_id_fkey'
            columns: ['item_id']
            isOneToOne: false
            referencedRelation: 'inventory_items'
            referencedColumns: ['id']
          },
        ]
      }
      inventory_import_batches: {
        Row: {
          id: string
          source_files: string[]
          import_policy: string
          imported_count: number
          skipped_count: number
          duplicate_count: number
          exception_count: number
          started_at: string
          completed_at: string | null
          created_by: string | null
        }
        Insert: {
          id?: string
          source_files?: string[]
          import_policy: string
          imported_count?: number
          skipped_count?: number
          duplicate_count?: number
          exception_count?: number
          started_at?: string
          completed_at?: string | null
          created_by?: string | null
        }
        Update: {
          id?: string
          source_files?: string[]
          import_policy?: string
          imported_count?: number
          skipped_count?: number
          duplicate_count?: number
          exception_count?: number
          started_at?: string
          completed_at?: string | null
          created_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'inventory_import_batches_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      inventory_import_exceptions: {
        Row: {
          id: string
          batch_id: string
          kind: string
          item_number: string | null
          item_name: string | null
          source_file: string
          source_sheet: string | null
          source_row: number | null
          raw_payload: Json
          resolution: string | null
          created_at: string
        }
        Insert: {
          id?: string
          batch_id: string
          kind: string
          item_number?: string | null
          item_name?: string | null
          source_file: string
          source_sheet?: string | null
          source_row?: number | null
          raw_payload?: Json
          resolution?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          batch_id?: string
          kind?: string
          item_number?: string | null
          item_name?: string | null
          source_file?: string
          source_sheet?: string | null
          source_row?: number | null
          raw_payload?: Json
          resolution?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'inventory_import_exceptions_batch_id_fkey'
            columns: ['batch_id']
            isOneToOne: false
            referencedRelation: 'inventory_import_batches'
            referencedColumns: ['id']
          },
        ]
      }
      inventory_item_categories: {
        Row: {
          id: string
          slug: string
          name: string
          description: string | null
          is_active: boolean
          sort_order: number
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
        }
        Insert: {
          id?: string
          slug: string
          name: string
          description?: string | null
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Update: {
          id?: string
          slug?: string
          name?: string
          description?: string | null
          is_active?: boolean
          sort_order?: number
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'inventory_item_categories_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_item_categories_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      inventory_item_group_members: {
        Row: {
          id: string
          group_id: string
          item_id: string
          created_at: string
          created_by: string | null
        }
        Insert: {
          id?: string
          group_id: string
          item_id: string
          created_at?: string
          created_by?: string | null
        }
        Update: {
          id?: string
          group_id?: string
          item_id?: string
          created_at?: string
          created_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'inventory_item_group_members_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_item_group_members_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'inventory_item_groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_item_group_members_item_id_fkey'
            columns: ['item_id']
            isOneToOne: false
            referencedRelation: 'inventory_items'
            referencedColumns: ['id']
          },
        ]
      }
      inventory_item_groups: {
        Row: {
          id: string
          name: string
          description: string | null
          status: 'active' | 'inactive'
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          status?: 'active' | 'inactive'
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          status?: 'active' | 'inactive'
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'inventory_item_groups_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_item_groups_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      inventory_item_movement_batches: {
        Row: {
          id: string
          move_scope: 'single' | 'bulk' | 'group' | 'claim'
          group_id: string | null
          destination_location_id: string
          note: string | null
          moved_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          move_scope?: 'single' | 'bulk' | 'group' | 'claim'
          group_id?: string | null
          destination_location_id: string
          note?: string | null
          moved_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          move_scope?: 'single' | 'bulk' | 'group' | 'claim'
          group_id?: string | null
          destination_location_id?: string
          note?: string | null
          moved_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'inventory_item_movement_batches_destination_location_id_fkey'
            columns: ['destination_location_id']
            isOneToOne: false
            referencedRelation: 'inventory_locations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_item_movement_batches_group_id_fkey'
            columns: ['group_id']
            isOneToOne: false
            referencedRelation: 'inventory_item_groups'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_item_movement_batches_moved_by_fkey'
            columns: ['moved_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      inventory_item_movements: {
        Row: {
          id: string
          item_id: string
          from_location_id: string | null
          to_location_id: string
          note: string | null
          moved_by: string | null
          moved_at: string
          movement_batch_id: string | null
        }
        Insert: {
          id?: string
          item_id: string
          from_location_id?: string | null
          to_location_id: string
          note?: string | null
          moved_by?: string | null
          moved_at?: string
          movement_batch_id?: string | null
        }
        Update: {
          id?: string
          item_id?: string
          from_location_id?: string | null
          to_location_id?: string
          note?: string | null
          moved_by?: string | null
          moved_at?: string
          movement_batch_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'inventory_item_movements_from_location_id_fkey'
            columns: ['from_location_id']
            isOneToOne: false
            referencedRelation: 'inventory_locations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_item_movements_item_id_fkey'
            columns: ['item_id']
            isOneToOne: false
            referencedRelation: 'inventory_items'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_item_movements_moved_by_fkey'
            columns: ['moved_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_item_movements_movement_batch_id_fkey'
            columns: ['movement_batch_id']
            isOneToOne: false
            referencedRelation: 'inventory_item_movement_batches'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_item_movements_to_location_id_fkey'
            columns: ['to_location_id']
            isOneToOne: false
            referencedRelation: 'inventory_locations'
            referencedColumns: ['id']
          },
        ]
      }
      inventory_items: {
        Row: {
          id: string
          item_number: string
          item_number_normalized: string
          name: string
          category: string
          location_id: string
          last_checked_at: string | null
          status: 'active' | 'retired'
          source: string | null
          source_reference: string | null
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
          check_interval_days: number | null
          retired_at: string | null
          retire_reason: string | null
          retired_by: string | null
        }
        Insert: {
          id?: string
          item_number: string
          item_number_normalized: string
          name: string
          category?: string
          location_id: string
          last_checked_at?: string | null
          status?: 'active' | 'retired'
          source?: string | null
          source_reference?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          check_interval_days?: number | null
          retired_at?: string | null
          retire_reason?: string | null
          retired_by?: string | null
        }
        Update: {
          id?: string
          item_number?: string
          item_number_normalized?: string
          name?: string
          category?: string
          location_id?: string
          last_checked_at?: string | null
          status?: 'active' | 'retired'
          source?: string | null
          source_reference?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          check_interval_days?: number | null
          retired_at?: string | null
          retire_reason?: string | null
          retired_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'inventory_items_category_fk'
            columns: ['category']
            isOneToOne: false
            referencedRelation: 'inventory_item_categories'
            referencedColumns: ['slug']
          },
          {
            foreignKeyName: 'inventory_items_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_items_location_id_fkey'
            columns: ['location_id']
            isOneToOne: false
            referencedRelation: 'inventory_locations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_items_retired_by_fkey'
            columns: ['retired_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_items_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      inventory_location_requests: {
        Row: {
          id: string
          suggested_name: string
          note: string | null
          requester_id: string
          status: 'pending' | 'approved' | 'rejected' | 'duplicate'
          resolved_location_id: string | null
          resolved_by: string | null
          resolved_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          suggested_name: string
          note?: string | null
          requester_id: string
          status?: 'pending' | 'approved' | 'rejected' | 'duplicate'
          resolved_location_id?: string | null
          resolved_by?: string | null
          resolved_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          suggested_name?: string
          note?: string | null
          requester_id?: string
          status?: 'pending' | 'approved' | 'rejected' | 'duplicate'
          resolved_location_id?: string | null
          resolved_by?: string | null
          resolved_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'inventory_location_requests_requester_id_fkey'
            columns: ['requester_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_location_requests_resolved_by_fkey'
            columns: ['resolved_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_location_requests_resolved_location_id_fkey'
            columns: ['resolved_location_id']
            isOneToOne: false
            referencedRelation: 'inventory_locations'
            referencedColumns: ['id']
          },
        ]
      }
      inventory_locations: {
        Row: {
          id: string
          name: string
          description: string | null
          is_active: boolean
          linked_van_id: string | null
          linked_hgv_id: string | null
          linked_plant_id: string | null
          location_type: 'yard' | 'unknown' | 'van' | 'hgv' | 'plant' | 'site' | 'manual'
          source_type: 'system' | 'fleet' | 'quote' | 'project_number' | 'legacy_quote' | 'manual' | null
          source_id: string | null
          external_reference: string | null
          sync_status: 'manual' | 'synced' | 'needs_review' | 'archived'
          source_synced_at: string | null
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          is_active?: boolean
          linked_van_id?: string | null
          linked_hgv_id?: string | null
          linked_plant_id?: string | null
          location_type?: 'yard' | 'unknown' | 'van' | 'hgv' | 'plant' | 'site' | 'manual'
          source_type?: 'system' | 'fleet' | 'quote' | 'project_number' | 'legacy_quote' | 'manual' | null
          source_id?: string | null
          external_reference?: string | null
          sync_status?: 'manual' | 'synced' | 'needs_review' | 'archived'
          source_synced_at?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          is_active?: boolean
          linked_van_id?: string | null
          linked_hgv_id?: string | null
          linked_plant_id?: string | null
          location_type?: 'yard' | 'unknown' | 'van' | 'hgv' | 'plant' | 'site' | 'manual'
          source_type?: 'system' | 'fleet' | 'quote' | 'project_number' | 'legacy_quote' | 'manual' | null
          source_id?: string | null
          external_reference?: string | null
          sync_status?: 'manual' | 'synced' | 'needs_review' | 'archived'
          source_synced_at?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'inventory_locations_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_locations_linked_hgv_id_fkey'
            columns: ['linked_hgv_id']
            isOneToOne: false
            referencedRelation: 'hgvs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_locations_linked_plant_id_fkey'
            columns: ['linked_plant_id']
            isOneToOne: false
            referencedRelation: 'plant'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_locations_linked_van_id_fkey'
            columns: ['linked_van_id']
            isOneToOne: false
            referencedRelation: 'vans'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_locations_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      inventory_minor_plant_details: {
        Row: {
          id: string
          inventory_item_id: string
          source_plant_id: string | null
          plant_identifier: string | null
          make: string | null
          model: string | null
          reg_number: string | null
          year: number | null
          weight_class: string | null
          copied_at: string | null
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
          serial_number: string | null
        }
        Insert: {
          id?: string
          inventory_item_id: string
          source_plant_id?: string | null
          plant_identifier?: string | null
          make?: string | null
          model?: string | null
          reg_number?: string | null
          year?: number | null
          weight_class?: string | null
          copied_at?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          serial_number?: string | null
        }
        Update: {
          id?: string
          inventory_item_id?: string
          source_plant_id?: string | null
          plant_identifier?: string | null
          make?: string | null
          model?: string | null
          reg_number?: string | null
          year?: number | null
          weight_class?: string | null
          copied_at?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
          serial_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'inventory_minor_plant_details_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_minor_plant_details_inventory_item_id_fkey'
            columns: ['inventory_item_id']
            isOneToOne: false
            referencedRelation: 'inventory_items'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_minor_plant_details_source_plant_id_fkey'
            columns: ['source_plant_id']
            isOneToOne: false
            referencedRelation: 'plant'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_minor_plant_details_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      inventory_user_locations: {
        Row: {
          user_id: string
          location_id: string
          created_at: string
          updated_at: string
          updated_by: string | null
          change_reason: string | null
        }
        Insert: {
          user_id: string
          location_id: string
          created_at?: string
          updated_at?: string
          updated_by?: string | null
          change_reason?: string | null
        }
        Update: {
          user_id?: string
          location_id?: string
          created_at?: string
          updated_at?: string
          updated_by?: string | null
          change_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'inventory_user_locations_location_id_fkey'
            columns: ['location_id']
            isOneToOne: false
            referencedRelation: 'inventory_locations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_user_locations_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_user_locations_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      inventory_user_site_locations: {
        Row: {
          user_id: string
          location_id: string
          assigned_by: string | null
          assigned_at: string
          note: string | null
        }
        Insert: {
          user_id: string
          location_id: string
          assigned_by?: string | null
          assigned_at?: string
          note?: string | null
        }
        Update: {
          user_id?: string
          location_id?: string
          assigned_by?: string | null
          assigned_at?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'inventory_user_site_locations_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_user_site_locations_location_id_fkey'
            columns: ['location_id']
            isOneToOne: false
            referencedRelation: 'inventory_locations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'inventory_user_site_locations_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      legacy_quote_import_batches: {
        Row: {
          id: string
          source_file: string
          source_hash: string
          imported_at: string
          record_count: number
          invalid_reference_count: number
          metadata: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          source_file: string
          source_hash: string
          imported_at?: string
          record_count?: number
          invalid_reference_count?: number
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          source_file?: string
          source_hash?: string
          imported_at?: string
          record_count?: number
          invalid_reference_count?: number
          metadata?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      legacy_quotes: {
        Row: {
          id: string
          import_batch_id: string | null
          source_row: number
          source_hash: string
          quote_reference: string | null
          quote_number: number | null
          quote_suffix: string | null
          customer_name: string
          title: string
          quote_date: string | null
          quote_date_raw: string | null
          quote_manager_name: string
          quote_manager_initials: string | null
          quote_value_text: string | null
          quote_value_amount: number | null
          comments: string | null
          raw_data: Json
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          import_batch_id?: string | null
          source_row: number
          source_hash: string
          quote_reference?: string | null
          quote_number?: number | null
          quote_suffix?: string | null
          customer_name?: string
          title?: string
          quote_date?: string | null
          quote_date_raw?: string | null
          quote_manager_name?: string
          quote_manager_initials?: string | null
          quote_value_text?: string | null
          quote_value_amount?: number | null
          comments?: string | null
          raw_data?: Json
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          import_batch_id?: string | null
          source_row?: number
          source_hash?: string
          quote_reference?: string | null
          quote_number?: number | null
          quote_suffix?: string | null
          customer_name?: string
          title?: string
          quote_date?: string | null
          quote_date_raw?: string | null
          quote_manager_name?: string
          quote_manager_initials?: string | null
          quote_value_text?: string | null
          quote_value_amount?: number | null
          comments?: string | null
          raw_data?: Json
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'legacy_quotes_import_batch_id_fkey'
            columns: ['import_batch_id']
            isOneToOne: false
            referencedRelation: 'legacy_quote_import_batches'
            referencedColumns: ['id']
          },
        ]
      }
      maintenance_categories: {
        Row: {
          id: string
          name: string
          description: string | null
          type: 'date' | 'mileage' | 'hours'
          alert_threshold_days: number | null
          alert_threshold_miles: number | null
          is_active: boolean | null
          sort_order: number | null
          created_at: string | null
          updated_at: string | null
          responsibility: 'workshop' | 'office' | null
          show_on_overview: boolean | null
          reminder_in_app_enabled: boolean | null
          reminder_email_enabled: boolean | null
          alert_threshold_hours: number | null
          applies_to: string[] | null
          period_value: number
          period_unit: string
          field_key: string | null
          is_system: boolean
          is_delete_protected: boolean
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          type: 'date' | 'mileage' | 'hours'
          alert_threshold_days?: number | null
          alert_threshold_miles?: number | null
          is_active?: boolean | null
          sort_order?: number | null
          created_at?: string | null
          updated_at?: string | null
          responsibility?: 'workshop' | 'office' | null
          show_on_overview?: boolean | null
          reminder_in_app_enabled?: boolean | null
          reminder_email_enabled?: boolean | null
          alert_threshold_hours?: number | null
          applies_to?: string[] | null
          period_value: number
          period_unit: string
          field_key?: string | null
          is_system?: boolean
          is_delete_protected?: boolean
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          type?: 'date' | 'mileage' | 'hours'
          alert_threshold_days?: number | null
          alert_threshold_miles?: number | null
          is_active?: boolean | null
          sort_order?: number | null
          created_at?: string | null
          updated_at?: string | null
          responsibility?: 'workshop' | 'office' | null
          show_on_overview?: boolean | null
          reminder_in_app_enabled?: boolean | null
          reminder_email_enabled?: boolean | null
          alert_threshold_hours?: number | null
          applies_to?: string[] | null
          period_value?: number
          period_unit?: string
          field_key?: string | null
          is_system?: boolean
          is_delete_protected?: boolean
        }
        Relationships: [
        ]
      }
      maintenance_category_recipients: {
        Row: {
          id: string
          category_id: string
          user_id: string
          created_at: string | null
        }
        Insert: {
          id?: string
          category_id: string
          user_id: string
          created_at?: string | null
        }
        Update: {
          id?: string
          category_id?: string
          user_id?: string
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'maintenance_category_recipients_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'maintenance_categories'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'maintenance_category_recipients_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      maintenance_history: {
        Row: {
          id: string
          van_id: string | null
          maintenance_category_id: string | null
          field_name: string
          old_value: string | null
          new_value: string | null
          value_type: 'date' | 'mileage' | 'boolean' | 'text'
          comment: string
          updated_by: string | null
          updated_by_name: string | null
          created_at: string | null
          plant_id: string | null
          hgv_id: string | null
        }
        Insert: {
          id?: string
          van_id?: string | null
          maintenance_category_id?: string | null
          field_name: string
          old_value?: string | null
          new_value?: string | null
          value_type: 'date' | 'mileage' | 'boolean' | 'text'
          comment: string
          updated_by?: string | null
          updated_by_name?: string | null
          created_at?: string | null
          plant_id?: string | null
          hgv_id?: string | null
        }
        Update: {
          id?: string
          van_id?: string | null
          maintenance_category_id?: string | null
          field_name?: string
          old_value?: string | null
          new_value?: string | null
          value_type?: 'date' | 'mileage' | 'boolean' | 'text'
          comment?: string
          updated_by?: string | null
          updated_by_name?: string | null
          created_at?: string | null
          plant_id?: string | null
          hgv_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'maintenance_history_hgv_id_fkey'
            columns: ['hgv_id']
            isOneToOne: false
            referencedRelation: 'hgvs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'maintenance_history_maintenance_category_id_fkey'
            columns: ['maintenance_category_id']
            isOneToOne: false
            referencedRelation: 'maintenance_categories'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'maintenance_history_plant_id_fkey'
            columns: ['plant_id']
            isOneToOne: false
            referencedRelation: 'plant'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'maintenance_history_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'maintenance_history_van_id_fkey'
            columns: ['van_id']
            isOneToOne: false
            referencedRelation: 'vans'
            referencedColumns: ['id']
          },
        ]
      }
      message_recipients: {
        Row: {
          id: string
          message_id: string | null
          user_id: string | null
          status: 'PENDING' | 'SHOWN' | 'SIGNED' | 'DISMISSED'
          signed_at: string | null
          first_shown_at: string | null
          cleared_from_inbox_at: string | null
          signature_data: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          message_id?: string | null
          user_id?: string | null
          status?: 'PENDING' | 'SHOWN' | 'SIGNED' | 'DISMISSED'
          signed_at?: string | null
          first_shown_at?: string | null
          cleared_from_inbox_at?: string | null
          signature_data?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          message_id?: string | null
          user_id?: string | null
          status?: 'PENDING' | 'SHOWN' | 'SIGNED' | 'DISMISSED'
          signed_at?: string | null
          first_shown_at?: string | null
          cleared_from_inbox_at?: string | null
          signature_data?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'message_recipients_message_id_fkey'
            columns: ['message_id']
            isOneToOne: false
            referencedRelation: 'messages'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'message_recipients_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      messages: {
        Row: {
          id: string
          type: 'TOOLBOX_TALK' | 'REMINDER' | 'NOTIFICATION'
          subject: string
          body: string
          priority: 'LOW' | 'HIGH' | 'URGENT'
          sender_id: string | null
          created_at: string | null
          updated_at: string | null
          deleted_at: string | null
          created_via: string | null
          pdf_file_path: string | null
          acceptance_delay_minutes: number
          module_key: 'errors' | 'maintenance' | 'rams' | 'approvals' | 'inspections' | 'absence' | 'timesheets' | 'inventory' | 'processed_absence' | 'training' | 'suggestions' | 'toolbox_talks' | 'reminders' | 'quotes' | 'general_notifications' | 'sensitive_pin_security'
        }
        Insert: {
          id?: string
          type: 'TOOLBOX_TALK' | 'REMINDER' | 'NOTIFICATION'
          subject: string
          body: string
          priority: 'LOW' | 'HIGH' | 'URGENT'
          sender_id?: string | null
          created_at?: string | null
          updated_at?: string | null
          deleted_at?: string | null
          created_via?: string | null
          pdf_file_path?: string | null
          acceptance_delay_minutes?: number
          module_key?: 'errors' | 'maintenance' | 'rams' | 'approvals' | 'inspections' | 'absence' | 'timesheets' | 'inventory' | 'processed_absence' | 'training' | 'suggestions' | 'toolbox_talks' | 'reminders' | 'quotes' | 'general_notifications' | 'sensitive_pin_security'
        }
        Update: {
          id?: string
          type?: 'TOOLBOX_TALK' | 'REMINDER' | 'NOTIFICATION'
          subject?: string
          body?: string
          priority?: 'LOW' | 'HIGH' | 'URGENT'
          sender_id?: string | null
          created_at?: string | null
          updated_at?: string | null
          deleted_at?: string | null
          created_via?: string | null
          pdf_file_path?: string | null
          acceptance_delay_minutes?: number
          module_key?: 'errors' | 'maintenance' | 'rams' | 'approvals' | 'inspections' | 'absence' | 'timesheets' | 'inventory' | 'processed_absence' | 'training' | 'suggestions' | 'toolbox_talks' | 'reminders' | 'quotes' | 'general_notifications' | 'sensitive_pin_security'
        }
        Relationships: [
          {
            foreignKeyName: 'messages_sender_id_fkey'
            columns: ['sender_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      mot_test_comments: {
        Row: {
          id: string
          mot_test_id: string
          comment_text: string
          comment_type: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          mot_test_id: string
          comment_text: string
          comment_type?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          mot_test_id?: string
          comment_text?: string
          comment_type?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'mot_test_comments_mot_test_id_fkey'
            columns: ['mot_test_id']
            isOneToOne: false
            referencedRelation: 'mot_test_history'
            referencedColumns: ['id']
          },
        ]
      }
      mot_test_defects: {
        Row: {
          id: string
          mot_test_id: string
          type: string
          text: string
          location_lateral: string | null
          location_longitudinal: string | null
          location_vertical: string | null
          dangerous: boolean | null
          created_at: string | null
        }
        Insert: {
          id?: string
          mot_test_id: string
          type: string
          text: string
          location_lateral?: string | null
          location_longitudinal?: string | null
          location_vertical?: string | null
          dangerous?: boolean | null
          created_at?: string | null
        }
        Update: {
          id?: string
          mot_test_id?: string
          type?: string
          text?: string
          location_lateral?: string | null
          location_longitudinal?: string | null
          location_vertical?: string | null
          dangerous?: boolean | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'mot_test_defects_mot_test_id_fkey'
            columns: ['mot_test_id']
            isOneToOne: false
            referencedRelation: 'mot_test_history'
            referencedColumns: ['id']
          },
        ]
      }
      mot_test_history: {
        Row: {
          id: string
          van_id: string | null
          mot_test_number: string
          completed_date: string
          test_result: string
          expiry_date: string | null
          odometer_value: number | null
          odometer_unit: string | null
          odometer_result_type: string | null
          test_class: string | null
          test_type: string | null
          cylinder_capacity: number | null
          test_station_number: string | null
          test_station_name: string | null
          test_station_pcode: string | null
          created_at: string | null
          updated_at: string | null
          hgv_id: string | null
        }
        Insert: {
          id?: string
          van_id?: string | null
          mot_test_number: string
          completed_date: string
          test_result: string
          expiry_date?: string | null
          odometer_value?: number | null
          odometer_unit?: string | null
          odometer_result_type?: string | null
          test_class?: string | null
          test_type?: string | null
          cylinder_capacity?: number | null
          test_station_number?: string | null
          test_station_name?: string | null
          test_station_pcode?: string | null
          created_at?: string | null
          updated_at?: string | null
          hgv_id?: string | null
        }
        Update: {
          id?: string
          van_id?: string | null
          mot_test_number?: string
          completed_date?: string
          test_result?: string
          expiry_date?: string | null
          odometer_value?: number | null
          odometer_unit?: string | null
          odometer_result_type?: string | null
          test_class?: string | null
          test_type?: string | null
          cylinder_capacity?: number | null
          test_station_number?: string | null
          test_station_name?: string | null
          test_station_pcode?: string | null
          created_at?: string | null
          updated_at?: string | null
          hgv_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'mot_test_history_hgv_id_fkey'
            columns: ['hgv_id']
            isOneToOne: false
            referencedRelation: 'hgvs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'mot_test_history_van_id_fkey'
            columns: ['van_id']
            isOneToOne: false
            referencedRelation: 'vans'
            referencedColumns: ['id']
          },
        ]
      }
      notification_preferences: {
        Row: {
          id: string
          user_id: string
          module_key: 'errors' | 'maintenance' | 'rams' | 'approvals' | 'inspections' | 'absence' | 'timesheets' | 'inventory' | 'processed_absence' | 'training' | 'suggestions' | 'toolbox_talks' | 'reminders' | 'quotes' | 'general_notifications' | 'sensitive_pin_security'
          enabled: boolean | null
          notify_in_app: boolean | null
          notify_email: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          module_key: 'errors' | 'maintenance' | 'rams' | 'approvals' | 'inspections' | 'absence' | 'timesheets' | 'inventory' | 'processed_absence' | 'training' | 'suggestions' | 'toolbox_talks' | 'reminders' | 'quotes' | 'general_notifications' | 'sensitive_pin_security'
          enabled?: boolean | null
          notify_in_app?: boolean | null
          notify_email?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          module_key?: 'errors' | 'maintenance' | 'rams' | 'approvals' | 'inspections' | 'absence' | 'timesheets' | 'inventory' | 'processed_absence' | 'training' | 'suggestions' | 'toolbox_talks' | 'reminders' | 'quotes' | 'general_notifications' | 'sensitive_pin_security'
          enabled?: boolean | null
          notify_in_app?: boolean | null
          notify_email?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'notification_preferences_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      org_hierarchy_change_log: {
        Row: {
          id: string
          change_type: string
          entity_name: string
          entity_id: string | null
          before_json: Json | null
          after_json: Json | null
          changed_by: string | null
          changed_at: string
        }
        Insert: {
          id?: string
          change_type: string
          entity_name: string
          entity_id?: string | null
          before_json?: Json | null
          after_json?: Json | null
          changed_by?: string | null
          changed_at?: string
        }
        Update: {
          id?: string
          change_type?: string
          entity_name?: string
          entity_id?: string | null
          before_json?: Json | null
          after_json?: Json | null
          changed_by?: string | null
          changed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'org_hierarchy_change_log_changed_by_fkey'
            columns: ['changed_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      org_team_feature_modes: {
        Row: {
          id: string
          team_id: string
          workflow_name: string
          mode: string
          effective_from: string
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          team_id: string
          workflow_name: string
          mode?: string
          effective_from?: string
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          team_id?: string
          workflow_name?: string
          mode?: string
          effective_from?: string
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'org_team_feature_modes_team_id_fkey'
            columns: ['team_id']
            isOneToOne: false
            referencedRelation: 'org_teams'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'org_team_feature_modes_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      org_teams: {
        Row: {
          id: string
          name: string
          code: string | null
          active: boolean
          created_at: string
          updated_at: string
          manager_1_profile_id: string | null
          manager_2_profile_id: string | null
          timesheet_type: 'civils' | 'plant' | null
        }
        Insert: {
          id: string
          name: string
          code?: string | null
          active?: boolean
          created_at?: string
          updated_at?: string
          manager_1_profile_id?: string | null
          manager_2_profile_id?: string | null
          timesheet_type?: 'civils' | 'plant' | null
        }
        Update: {
          id?: string
          name?: string
          code?: string | null
          active?: boolean
          created_at?: string
          updated_at?: string
          manager_1_profile_id?: string | null
          manager_2_profile_id?: string | null
          timesheet_type?: 'civils' | 'plant' | null
        }
        Relationships: [
          {
            foreignKeyName: 'org_teams_manager_1_profile_id_fkey'
            columns: ['manager_1_profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'org_teams_manager_2_profile_id_fkey'
            columns: ['manager_2_profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      permission_modules: {
        Row: {
          module_name: string
          minimum_role_id: string
          sort_order: number
          created_at: string
          updated_at: string
          requires_sensitive_pin: boolean
        }
        Insert: {
          module_name: string
          minimum_role_id: string
          sort_order: number
          created_at?: string
          updated_at?: string
          requires_sensitive_pin?: boolean
        }
        Update: {
          module_name?: string
          minimum_role_id?: string
          sort_order?: number
          created_at?: string
          updated_at?: string
          requires_sensitive_pin?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'permission_modules_minimum_role_id_fkey'
            columns: ['minimum_role_id']
            isOneToOne: false
            referencedRelation: 'roles'
            referencedColumns: ['id']
          },
        ]
      }
      plant: {
        Row: {
          id: string
          plant_id: string
          nickname: string | null
          make: string | null
          model: string | null
          serial_number: string | null
          year: number | null
          weight_class: string | null
          category_id: string
          loler_due_date: string | null
          loler_last_inspection_date: string | null
          loler_certificate_number: string | null
          loler_inspection_interval_months: number | null
          current_hours: number | null
          status: 'active' | 'inactive' | 'maintenance' | 'retired' | null
          created_at: string | null
          updated_at: string | null
          created_by: string | null
          updated_by: string | null
          reg_number: string | null
          retired_at: string | null
          retire_reason: string | null
        }
        Insert: {
          id?: string
          plant_id: string
          nickname?: string | null
          make?: string | null
          model?: string | null
          serial_number?: string | null
          year?: number | null
          weight_class?: string | null
          category_id: string
          loler_due_date?: string | null
          loler_last_inspection_date?: string | null
          loler_certificate_number?: string | null
          loler_inspection_interval_months?: number | null
          current_hours?: number | null
          status?: 'active' | 'inactive' | 'maintenance' | 'retired' | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
          updated_by?: string | null
          reg_number?: string | null
          retired_at?: string | null
          retire_reason?: string | null
        }
        Update: {
          id?: string
          plant_id?: string
          nickname?: string | null
          make?: string | null
          model?: string | null
          serial_number?: string | null
          year?: number | null
          weight_class?: string | null
          category_id?: string
          loler_due_date?: string | null
          loler_last_inspection_date?: string | null
          loler_certificate_number?: string | null
          loler_inspection_interval_months?: number | null
          current_hours?: number | null
          status?: 'active' | 'inactive' | 'maintenance' | 'retired' | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
          updated_by?: string | null
          reg_number?: string | null
          retired_at?: string | null
          retire_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'plant_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'van_categories'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'plant_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'plant_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      plant_inspections: {
        Row: {
          id: string
          vehicle_id: string | null
          plant_id: string | null
          user_id: string
          inspection_date: string
          inspection_end_date: string | null
          current_mileage: number | null
          status: 'draft' | 'submitted'
          submitted_at: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          manager_comments: string | null
          inspector_comments: string | null
          signature_data: string | null
          signed_at: string | null
          is_hired_plant: boolean
          hired_plant_id_serial: string | null
          hired_plant_description: string | null
          hired_plant_hiring_company: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          vehicle_id?: string | null
          plant_id?: string | null
          user_id: string
          inspection_date: string
          inspection_end_date?: string | null
          current_mileage?: number | null
          status?: 'draft' | 'submitted'
          submitted_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          manager_comments?: string | null
          inspector_comments?: string | null
          signature_data?: string | null
          signed_at?: string | null
          is_hired_plant?: boolean
          hired_plant_id_serial?: string | null
          hired_plant_description?: string | null
          hired_plant_hiring_company?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          vehicle_id?: string | null
          plant_id?: string | null
          user_id?: string
          inspection_date?: string
          inspection_end_date?: string | null
          current_mileage?: number | null
          status?: 'draft' | 'submitted'
          submitted_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          manager_comments?: string | null
          inspector_comments?: string | null
          signature_data?: string | null
          signed_at?: string | null
          is_hired_plant?: boolean
          hired_plant_id_serial?: string | null
          hired_plant_description?: string | null
          hired_plant_hiring_company?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'plant_inspections_plant_id_fkey'
            columns: ['plant_id']
            isOneToOne: false
            referencedRelation: 'plant'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'plant_inspections_reviewed_by_fkey'
            columns: ['reviewed_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'plant_inspections_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      profile_reporting_lines: {
        Row: {
          id: string
          profile_id: string
          manager_profile_id: string
          relation_type: 'primary' | 'secondary' | 'line_manager'
          valid_from: string
          valid_to: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          manager_profile_id: string
          relation_type?: 'primary' | 'secondary' | 'line_manager'
          valid_from?: string
          valid_to?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          manager_profile_id?: string
          relation_type?: 'primary' | 'secondary' | 'line_manager'
          valid_from?: string
          valid_to?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'profile_reporting_lines_manager_profile_id_fkey'
            columns: ['manager_profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'profile_reporting_lines_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      profile_sensitive_pins: {
        Row: {
          profile_id: string
          pin_hash: string | null
          pin_salt: string | null
          pin_length: number | null
          failed_attempts: number
          locked_until: string | null
          must_reset: boolean
          last_changed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          profile_id: string
          pin_hash?: string | null
          pin_salt?: string | null
          pin_length?: number | null
          failed_attempts?: number
          locked_until?: string | null
          must_reset?: boolean
          last_changed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          profile_id?: string
          pin_hash?: string | null
          pin_salt?: string | null
          pin_length?: number | null
          failed_attempts?: number
          locked_until?: string | null
          must_reset?: boolean
          last_changed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'profile_sensitive_pins_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      profile_team_memberships: {
        Row: {
          id: string
          profile_id: string
          team_id: string
          is_primary: boolean
          valid_from: string
          valid_to: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          team_id: string
          is_primary?: boolean
          valid_from?: string
          valid_to?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          team_id?: string
          is_primary?: boolean
          valid_from?: string
          valid_to?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'profile_team_memberships_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'profile_team_memberships_team_id_fkey'
            columns: ['team_id']
            isOneToOne: false
            referencedRelation: 'org_teams'
            referencedColumns: ['id']
          },
        ]
      }
      profile_fleet_assignments: {
        Row: {
          id: string
          user_id: string
          linked_van_id: string | null
          linked_hgv_id: string | null
          linked_plant_id: string | null
          source: 'inventory_location' | 'admin'
          source_location_id: string | null
          change_reason: string | null
          assigned_by: string | null
          ended_by: string | null
          assigned_at: string
          ended_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          linked_van_id?: string | null
          linked_hgv_id?: string | null
          linked_plant_id?: string | null
          source?: 'inventory_location' | 'admin'
          source_location_id?: string | null
          change_reason?: string | null
          assigned_by?: string | null
          ended_by?: string | null
          assigned_at?: string
          ended_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          linked_van_id?: string | null
          linked_hgv_id?: string | null
          linked_plant_id?: string | null
          source?: 'inventory_location' | 'admin'
          source_location_id?: string | null
          change_reason?: string | null
          assigned_by?: string | null
          ended_by?: string | null
          assigned_at?: string
          ended_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'profile_fleet_assignments_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'profile_fleet_assignments_ended_by_fkey'
            columns: ['ended_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'profile_fleet_assignments_linked_hgv_id_fkey'
            columns: ['linked_hgv_id']
            isOneToOne: false
            referencedRelation: 'hgvs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'profile_fleet_assignments_linked_plant_id_fkey'
            columns: ['linked_plant_id']
            isOneToOne: false
            referencedRelation: 'plant'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'profile_fleet_assignments_linked_van_id_fkey'
            columns: ['linked_van_id']
            isOneToOne: false
            referencedRelation: 'vans'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'profile_fleet_assignments_source_location_id_fkey'
            columns: ['source_location_id']
            isOneToOne: false
            referencedRelation: 'inventory_locations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'profile_fleet_assignments_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      profiles: {
        Row: {
          id: string
          employee_id: string | null
          full_name: string
          role: string | null
          created_at: string | null
          updated_at: string | null
          must_change_password: boolean | null
          phone_number: string | null
          annual_holiday_allowance_days: number | null
          role_id: string | null
          super_admin: boolean | null
          team_id: string | null
          line_manager_id: string | null
          secondary_manager_id: string | null
          is_placeholder: boolean
          placeholder_key: string | null
          avatar_url: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          emergency_contact_relationship: string | null
          secondary_emergency_contact_name: string | null
          secondary_emergency_contact_phone: string | null
          secondary_emergency_contact_relationship: string | null
          employer_profile_notes: string | null
        }
        Insert: {
          id: string
          employee_id?: string | null
          full_name: string
          role?: string | null
          created_at?: string | null
          updated_at?: string | null
          must_change_password?: boolean | null
          phone_number?: string | null
          annual_holiday_allowance_days?: number | null
          role_id?: string | null
          super_admin?: boolean | null
          team_id?: string | null
          line_manager_id?: string | null
          secondary_manager_id?: string | null
          is_placeholder?: boolean
          placeholder_key?: string | null
          avatar_url?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          secondary_emergency_contact_name?: string | null
          secondary_emergency_contact_phone?: string | null
          secondary_emergency_contact_relationship?: string | null
          employer_profile_notes?: string | null
        }
        Update: {
          id?: string
          employee_id?: string | null
          full_name?: string
          role?: string | null
          created_at?: string | null
          updated_at?: string | null
          must_change_password?: boolean | null
          phone_number?: string | null
          annual_holiday_allowance_days?: number | null
          role_id?: string | null
          super_admin?: boolean | null
          team_id?: string | null
          line_manager_id?: string | null
          secondary_manager_id?: string | null
          is_placeholder?: boolean
          placeholder_key?: string | null
          avatar_url?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          secondary_emergency_contact_name?: string | null
          secondary_emergency_contact_phone?: string | null
          secondary_emergency_contact_relationship?: string | null
          employer_profile_notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'profiles_line_manager_id_fkey'
            columns: ['line_manager_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'profiles_role_id_fkey'
            columns: ['role_id']
            isOneToOne: false
            referencedRelation: 'roles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'profiles_secondary_manager_id_fkey'
            columns: ['secondary_manager_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'profiles_team_id_fkey'
            columns: ['team_id']
            isOneToOne: false
            referencedRelation: 'org_teams'
            referencedColumns: ['id']
          },
        ]
      }
      project_document_types: {
        Row: {
          id: string
          name: string
          description: string | null
          required_signature: boolean
          is_active: boolean
          sort_order: number
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          required_signature?: boolean
          is_active?: boolean
          sort_order?: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          required_signature?: boolean
          is_active?: boolean
          sort_order?: number
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'project_document_types_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      project_favourites: {
        Row: {
          id: string
          document_id: string
          user_id: string
          created_at: string
        }
        Insert: {
          id?: string
          document_id: string
          user_id: string
          created_at?: string
        }
        Update: {
          id?: string
          document_id?: string
          user_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'project_favourites_document_id_fkey'
            columns: ['document_id']
            isOneToOne: false
            referencedRelation: 'rams_documents'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'project_favourites_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      quote_attachments: {
        Row: {
          id: string
          quote_id: string
          file_name: string
          file_path: string
          content_type: string | null
          file_size: number | null
          uploaded_by: string | null
          created_at: string
          is_client_visible: boolean
          attachment_purpose: 'internal' | 'client_pricing' | 'client_supporting'
        }
        Insert: {
          id?: string
          quote_id: string
          file_name: string
          file_path: string
          content_type?: string | null
          file_size?: number | null
          uploaded_by?: string | null
          created_at?: string
          is_client_visible?: boolean
          attachment_purpose?: 'internal' | 'client_pricing' | 'client_supporting'
        }
        Update: {
          id?: string
          quote_id?: string
          file_name?: string
          file_path?: string
          content_type?: string | null
          file_size?: number | null
          uploaded_by?: string | null
          created_at?: string
          is_client_visible?: boolean
          attachment_purpose?: 'internal' | 'client_pricing' | 'client_supporting'
        }
        Relationships: [
          {
            foreignKeyName: 'quote_attachments_quote_id_fkey'
            columns: ['quote_id']
            isOneToOne: false
            referencedRelation: 'quotes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_attachments_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      quote_customer_contact_recipients: {
        Row: {
          quote_id: string
          customer_contact_id: string
          created_at: string
          created_by: string | null
        }
        Insert: {
          quote_id: string
          customer_contact_id: string
          created_at?: string
          created_by?: string | null
        }
        Update: {
          quote_id?: string
          customer_contact_id?: string
          created_at?: string
          created_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'quote_customer_contact_recipients_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_customer_contact_recipients_customer_contact_id_fkey'
            columns: ['customer_contact_id']
            isOneToOne: false
            referencedRelation: 'customer_contacts'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_customer_contact_recipients_quote_id_fkey'
            columns: ['quote_id']
            isOneToOne: false
            referencedRelation: 'quotes'
            referencedColumns: ['id']
          },
        ]
      }
      quote_email_templates: {
        Row: {
          template_key: string
          subject_template: string
          body_template: string
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          template_key: string
          subject_template: string
          body_template: string
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          template_key?: string
          subject_template?: string
          body_template?: string
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'quote_email_templates_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      quote_invoice_allocations: {
        Row: {
          id: string
          quote_invoice_id: string
          quote_line_item_id: string | null
          quantity_invoiced: number | null
          amount_invoiced: number
          comments: string | null
          created_at: string
        }
        Insert: {
          id?: string
          quote_invoice_id: string
          quote_line_item_id?: string | null
          quantity_invoiced?: number | null
          amount_invoiced: number
          comments?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          quote_invoice_id?: string
          quote_line_item_id?: string | null
          quantity_invoiced?: number | null
          amount_invoiced?: number
          comments?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'quote_invoice_allocations_quote_invoice_id_fkey'
            columns: ['quote_invoice_id']
            isOneToOne: false
            referencedRelation: 'quote_invoices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_invoice_allocations_quote_line_item_id_fkey'
            columns: ['quote_line_item_id']
            isOneToOne: false
            referencedRelation: 'quote_line_items'
            referencedColumns: ['id']
          },
        ]
      }
      quote_invoice_notification_recipients: {
        Row: {
          profile_id: string
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
          notification_type: 'invoice_request' | 'invoice_added' | 'quote_sent_copy' | 'start_alert_copy'
        }
        Insert: {
          profile_id: string
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
          notification_type?: 'invoice_request' | 'invoice_added' | 'quote_sent_copy' | 'start_alert_copy'
        }
        Update: {
          profile_id?: string
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
          notification_type?: 'invoice_request' | 'invoice_added' | 'quote_sent_copy' | 'start_alert_copy'
        }
        Relationships: [
          {
            foreignKeyName: 'quote_invoice_notification_recipients_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_invoice_notification_recipients_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_invoice_notification_recipients_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      quote_invoice_requests: {
        Row: {
          id: string
          quote_id: string
          requested_amount: number
          requested_invoice_date: string
          requested_invoice_scope: 'full' | 'partial'
          manager_comments: string | null
          status: 'pending' | 'fulfilled' | 'cancelled'
          requested_by: string | null
          requested_at: string
          notified_at: string | null
          fulfilled_invoice_id: string | null
          fulfilled_by: string | null
          fulfilled_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          quote_id: string
          requested_amount: number
          requested_invoice_date?: string
          requested_invoice_scope?: 'full' | 'partial'
          manager_comments?: string | null
          status?: 'pending' | 'fulfilled' | 'cancelled'
          requested_by?: string | null
          requested_at?: string
          notified_at?: string | null
          fulfilled_invoice_id?: string | null
          fulfilled_by?: string | null
          fulfilled_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          quote_id?: string
          requested_amount?: number
          requested_invoice_date?: string
          requested_invoice_scope?: 'full' | 'partial'
          manager_comments?: string | null
          status?: 'pending' | 'fulfilled' | 'cancelled'
          requested_by?: string | null
          requested_at?: string
          notified_at?: string | null
          fulfilled_invoice_id?: string | null
          fulfilled_by?: string | null
          fulfilled_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'quote_invoice_requests_fulfilled_by_fkey'
            columns: ['fulfilled_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_invoice_requests_fulfilled_invoice_id_fkey'
            columns: ['fulfilled_invoice_id']
            isOneToOne: false
            referencedRelation: 'quote_invoices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_invoice_requests_quote_id_fkey'
            columns: ['quote_id']
            isOneToOne: false
            referencedRelation: 'quotes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_invoice_requests_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      quote_invoices: {
        Row: {
          id: string
          quote_id: string
          invoice_number: string
          invoice_date: string
          amount: number
          invoice_scope: 'full' | 'partial'
          comments: string | null
          created_by: string | null
          created_at: string
          updated_at: string
          invoice_request_id: string | null
        }
        Insert: {
          id?: string
          quote_id: string
          invoice_number: string
          invoice_date?: string
          amount: number
          invoice_scope?: 'full' | 'partial'
          comments?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
          invoice_request_id?: string | null
        }
        Update: {
          id?: string
          quote_id?: string
          invoice_number?: string
          invoice_date?: string
          amount?: number
          invoice_scope?: 'full' | 'partial'
          comments?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
          invoice_request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'quote_invoices_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_invoices_invoice_request_id_fkey'
            columns: ['invoice_request_id']
            isOneToOne: false
            referencedRelation: 'quote_invoice_requests'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_invoices_quote_id_fkey'
            columns: ['quote_id']
            isOneToOne: false
            referencedRelation: 'quotes'
            referencedColumns: ['id']
          },
        ]
      }
      quote_project_costs: {
        Row: {
          id: string
          project_number_id: string
          cost_date: string
          category: 'materials' | 'subcontractor' | 'plant' | 'labour' | 'other'
          supplier: string | null
          description: string
          amount: number
          notes: string | null
          linked_quote_id: string | null
          linked_quote_line_item_id: string | null
          linked_at: string | null
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_number_id: string
          cost_date?: string
          category?: 'materials' | 'subcontractor' | 'plant' | 'labour' | 'other'
          supplier?: string | null
          description: string
          amount?: number
          notes?: string | null
          linked_quote_id?: string | null
          linked_quote_line_item_id?: string | null
          linked_at?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_number_id?: string
          cost_date?: string
          category?: 'materials' | 'subcontractor' | 'plant' | 'labour' | 'other'
          supplier?: string | null
          description?: string
          amount?: number
          notes?: string | null
          linked_quote_id?: string | null
          linked_quote_line_item_id?: string | null
          linked_at?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'quote_project_costs_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_project_costs_linked_quote_id_fkey'
            columns: ['linked_quote_id']
            isOneToOne: false
            referencedRelation: 'quotes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_project_costs_linked_quote_line_item_id_fkey'
            columns: ['linked_quote_line_item_id']
            isOneToOne: false
            referencedRelation: 'quote_line_items'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_project_costs_project_number_id_fkey'
            columns: ['project_number_id']
            isOneToOne: false
            referencedRelation: 'quote_project_numbers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_project_costs_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      quote_project_numbers: {
        Row: {
          id: string
          project_reference: string
          manager_profile_id: string
          requester_initials: string
          title: string
          description: string | null
          status: 'open' | 'linked' | 'converted' | 'cancelled'
          linked_quote_id: string | null
          linked_at: string | null
          converted_quote_id: string | null
          converted_at: string | null
          cancelled_at: string | null
          notes: string | null
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_reference: string
          manager_profile_id: string
          requester_initials: string
          title: string
          description?: string | null
          status?: 'open' | 'linked' | 'converted' | 'cancelled'
          linked_quote_id?: string | null
          linked_at?: string | null
          converted_quote_id?: string | null
          converted_at?: string | null
          cancelled_at?: string | null
          notes?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_reference?: string
          manager_profile_id?: string
          requester_initials?: string
          title?: string
          description?: string | null
          status?: 'open' | 'linked' | 'converted' | 'cancelled'
          linked_quote_id?: string | null
          linked_at?: string | null
          converted_quote_id?: string | null
          converted_at?: string | null
          cancelled_at?: string | null
          notes?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'quote_project_numbers_converted_quote_id_fkey'
            columns: ['converted_quote_id']
            isOneToOne: false
            referencedRelation: 'quotes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_project_numbers_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_project_numbers_linked_quote_id_fkey'
            columns: ['linked_quote_id']
            isOneToOne: false
            referencedRelation: 'quotes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_project_numbers_manager_profile_id_fkey'
            columns: ['manager_profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_project_numbers_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      quote_line_items: {
        Row: {
          id: string
          quote_id: string
          description: string
          quantity: number
          unit: string | null
          unit_rate: number
          line_total: number
          sort_order: number
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          quote_id: string
          description: string
          quantity?: number
          unit?: string | null
          unit_rate?: number
          line_total?: number
          sort_order?: number
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          quote_id?: string
          description?: string
          quantity?: number
          unit?: string | null
          unit_rate?: number
          line_total?: number
          sort_order?: number
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'quote_line_items_quote_id_fkey'
            columns: ['quote_id']
            isOneToOne: false
            referencedRelation: 'quotes'
            referencedColumns: ['id']
          },
        ]
      }
      quote_manager_series: {
        Row: {
          profile_id: string
          initials: string
          next_number: number
          number_start: number
          signoff_name: string | null
          signoff_title: string | null
          manager_email: string | null
          approver_profile_id: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          profile_id: string
          initials: string
          next_number: number
          number_start: number
          signoff_name?: string | null
          signoff_title?: string | null
          manager_email?: string | null
          approver_profile_id?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          profile_id?: string
          initials?: string
          next_number?: number
          number_start?: number
          signoff_name?: string | null
          signoff_title?: string | null
          manager_email?: string | null
          approver_profile_id?: string | null
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'quote_manager_series_approver_profile_id_fkey'
            columns: ['approver_profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_manager_series_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      quote_module_settings: {
        Row: {
          id: boolean
          default_start_alert_days: number | null
          default_estimated_duration_days: number | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: boolean
          default_start_alert_days?: number | null
          default_estimated_duration_days?: number | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: boolean
          default_start_alert_days?: number | null
          default_estimated_duration_days?: number | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'quote_module_settings_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      quote_sequences: {
        Row: {
          id: string
          requester_initials: string
          next_number: number
          updated_at: string | null
        }
        Insert: {
          id?: string
          requester_initials: string
          next_number?: number
          updated_at?: string | null
        }
        Update: {
          id?: string
          requester_initials?: string
          next_number?: number
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      quote_timeline_events: {
        Row: {
          id: string
          quote_id: string
          quote_thread_id: string
          quote_reference: string
          event_type: string
          title: string
          description: string | null
          from_status: string | null
          to_status: string | null
          actor_user_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          quote_id: string
          quote_thread_id: string
          quote_reference: string
          event_type: string
          title: string
          description?: string | null
          from_status?: string | null
          to_status?: string | null
          actor_user_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          quote_id?: string
          quote_thread_id?: string
          quote_reference?: string
          event_type?: string
          title?: string
          description?: string | null
          from_status?: string | null
          to_status?: string | null
          actor_user_id?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'quote_timeline_events_actor_user_id_fkey'
            columns: ['actor_user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_timeline_events_quote_id_fkey'
            columns: ['quote_id']
            isOneToOne: false
            referencedRelation: 'quotes'
            referencedColumns: ['id']
          },
        ]
      }
      quotes: {
        Row: {
          id: string
          quote_reference: string
          customer_id: string
          customer_site_id: string | null
          requester_id: string | null
          requester_initials: string | null
          quote_date: string
          attention_name: string | null
          attention_email: string | null
          subject_line: string | null
          project_description: string | null
          salutation: string | null
          validity_days: number | null
          subtotal: number | null
          total: number | null
          status: 'draft' | 'pending_internal_approval' | 'changes_requested' | 'approved' | 'sent' | 'won' | 'lost' | 'ready_to_invoice' | 'po_received' | 'in_progress' | 'completed_part' | 'completed_full' | 'partially_invoiced' | 'invoiced' | 'closed' | null
          accepted: boolean | null
          po_number: string | null
          started: boolean | null
          invoice_number: string | null
          invoice_notes: string | null
          signoff_name: string | null
          signoff_title: string | null
          custom_footer_text: string | null
          created_at: string | null
          updated_at: string | null
          created_by: string | null
          updated_by: string | null
          sent_at: string | null
          accepted_at: string | null
          invoiced_at: string | null
          base_quote_reference: string
          quote_thread_id: string
          parent_quote_id: string | null
          revision_number: number
          revision_type: 'original' | 'revision' | 'extra' | 'variation' | 'future_work' | 'duplicate'
          version_label: string | null
          version_notes: string | null
          is_latest_version: boolean
          duplicate_source_quote_id: string | null
          site_address: string | null
          manager_name: string | null
          manager_email: string | null
          approver_profile_id: string | null
          approved_by: string | null
          approved_at: string | null
          returned_at: string | null
          return_comments: string | null
          customer_sent_at: string | null
          customer_sent_by: string | null
          po_received_at: string | null
          po_value: number | null
          start_date: string | null
          start_alert_days: number | null
          start_alert_sent_at: string | null
          completion_status: 'not_completed' | 'approved_in_full' | 'approved_in_part'
          completion_comments: string | null
          commercial_status: 'open' | 'closed'
          closed_at: string | null
          rams_requested_at: string | null
          last_invoice_at: string | null
          scope: string | null
          estimated_duration_days: number | null
          estimated_duration_minutes: number | null
          pricing_mode: 'itemized' | 'attachments_only'
          sage_posted_at: string | null
          sage_posted_by: string | null
        }
        Insert: {
          id?: string
          quote_reference: string
          customer_id: string
          customer_site_id?: string | null
          requester_id?: string | null
          requester_initials?: string | null
          quote_date?: string
          attention_name?: string | null
          attention_email?: string | null
          subject_line?: string | null
          project_description?: string | null
          salutation?: string | null
          validity_days?: number | null
          subtotal?: number | null
          total?: number | null
          status?: 'draft' | 'pending_internal_approval' | 'changes_requested' | 'approved' | 'sent' | 'won' | 'lost' | 'ready_to_invoice' | 'po_received' | 'in_progress' | 'completed_part' | 'completed_full' | 'partially_invoiced' | 'invoiced' | 'closed' | null
          accepted?: boolean | null
          po_number?: string | null
          started?: boolean | null
          invoice_number?: string | null
          invoice_notes?: string | null
          signoff_name?: string | null
          signoff_title?: string | null
          custom_footer_text?: string | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
          updated_by?: string | null
          sent_at?: string | null
          accepted_at?: string | null
          invoiced_at?: string | null
          base_quote_reference: string
          quote_thread_id: string
          parent_quote_id?: string | null
          revision_number?: number
          revision_type?: 'original' | 'revision' | 'extra' | 'variation' | 'future_work' | 'duplicate'
          version_label?: string | null
          version_notes?: string | null
          is_latest_version?: boolean
          duplicate_source_quote_id?: string | null
          site_address?: string | null
          manager_name?: string | null
          manager_email?: string | null
          approver_profile_id?: string | null
          approved_by?: string | null
          approved_at?: string | null
          returned_at?: string | null
          return_comments?: string | null
          customer_sent_at?: string | null
          customer_sent_by?: string | null
          po_received_at?: string | null
          po_value?: number | null
          start_date?: string | null
          start_alert_days?: number | null
          start_alert_sent_at?: string | null
          completion_status?: 'not_completed' | 'approved_in_full' | 'approved_in_part'
          completion_comments?: string | null
          commercial_status?: 'open' | 'closed'
          closed_at?: string | null
          rams_requested_at?: string | null
          last_invoice_at?: string | null
          scope?: string | null
          estimated_duration_days?: number | null
          estimated_duration_minutes?: number | null
          pricing_mode?: 'itemized' | 'attachments_only'
          sage_posted_at?: string | null
          sage_posted_by?: string | null
        }
        Update: {
          id?: string
          quote_reference?: string
          customer_id?: string
          customer_site_id?: string | null
          requester_id?: string | null
          requester_initials?: string | null
          quote_date?: string
          attention_name?: string | null
          attention_email?: string | null
          subject_line?: string | null
          project_description?: string | null
          salutation?: string | null
          validity_days?: number | null
          subtotal?: number | null
          total?: number | null
          status?: 'draft' | 'pending_internal_approval' | 'changes_requested' | 'approved' | 'sent' | 'won' | 'lost' | 'ready_to_invoice' | 'po_received' | 'in_progress' | 'completed_part' | 'completed_full' | 'partially_invoiced' | 'invoiced' | 'closed' | null
          accepted?: boolean | null
          po_number?: string | null
          started?: boolean | null
          invoice_number?: string | null
          invoice_notes?: string | null
          signoff_name?: string | null
          signoff_title?: string | null
          custom_footer_text?: string | null
          created_at?: string | null
          updated_at?: string | null
          created_by?: string | null
          updated_by?: string | null
          sent_at?: string | null
          accepted_at?: string | null
          invoiced_at?: string | null
          base_quote_reference?: string
          quote_thread_id?: string
          parent_quote_id?: string | null
          revision_number?: number
          revision_type?: 'original' | 'revision' | 'extra' | 'variation' | 'future_work' | 'duplicate'
          version_label?: string | null
          version_notes?: string | null
          is_latest_version?: boolean
          duplicate_source_quote_id?: string | null
          site_address?: string | null
          manager_name?: string | null
          manager_email?: string | null
          approver_profile_id?: string | null
          approved_by?: string | null
          approved_at?: string | null
          returned_at?: string | null
          return_comments?: string | null
          customer_sent_at?: string | null
          customer_sent_by?: string | null
          po_received_at?: string | null
          po_value?: number | null
          start_date?: string | null
          start_alert_days?: number | null
          start_alert_sent_at?: string | null
          completion_status?: 'not_completed' | 'approved_in_full' | 'approved_in_part'
          completion_comments?: string | null
          commercial_status?: 'open' | 'closed'
          closed_at?: string | null
          rams_requested_at?: string | null
          last_invoice_at?: string | null
          scope?: string | null
          estimated_duration_days?: number | null
          estimated_duration_minutes?: number | null
          pricing_mode?: 'itemized' | 'attachments_only'
          sage_posted_at?: string | null
          sage_posted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'quotes_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quotes_approver_profile_id_fkey'
            columns: ['approver_profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quotes_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quotes_customer_id_fkey'
            columns: ['customer_id']
            isOneToOne: false
            referencedRelation: 'customers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quotes_customer_site_id_fkey'
            columns: ['customer_site_id']
            isOneToOne: false
            referencedRelation: 'customer_sites'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quotes_customer_sent_by_fkey'
            columns: ['customer_sent_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quotes_duplicate_source_quote_id_fkey'
            columns: ['duplicate_source_quote_id']
            isOneToOne: false
            referencedRelation: 'quotes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quotes_parent_quote_id_fkey'
            columns: ['parent_quote_id']
            isOneToOne: false
            referencedRelation: 'quotes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quotes_quote_thread_id_fkey'
            columns: ['quote_thread_id']
            isOneToOne: false
            referencedRelation: 'quotes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quotes_requester_id_fkey'
            columns: ['requester_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quotes_sage_posted_by_fkey'
            columns: ['sage_posted_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quotes_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      rams_assignments: {
        Row: {
          id: string
          rams_document_id: string | null
          employee_id: string | null
          assigned_at: string | null
          assigned_by: string | null
          status: string | null
          read_at: string | null
          signed_at: string | null
          signature_data: string | null
          comments: string | null
          action_taken: string | null
        }
        Insert: {
          id?: string
          rams_document_id?: string | null
          employee_id?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          status?: string | null
          read_at?: string | null
          signed_at?: string | null
          signature_data?: string | null
          comments?: string | null
          action_taken?: string | null
        }
        Update: {
          id?: string
          rams_document_id?: string | null
          employee_id?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          status?: string | null
          read_at?: string | null
          signed_at?: string | null
          signature_data?: string | null
          comments?: string | null
          action_taken?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'rams_assignments_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rams_assignments_employee_id_fkey'
            columns: ['employee_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rams_assignments_rams_document_id_fkey'
            columns: ['rams_document_id']
            isOneToOne: false
            referencedRelation: 'rams_documents'
            referencedColumns: ['id']
          },
        ]
      }
      rams_documents: {
        Row: {
          id: string
          title: string
          description: string | null
          file_name: string
          file_path: string
          file_size: number
          file_type: string
          uploaded_by: string | null
          created_at: string | null
          updated_at: string | null
          is_active: boolean | null
          version: number | null
          document_type_id: string | null
          quote_id: string | null
        }
        Insert: {
          id?: string
          title: string
          description?: string | null
          file_name: string
          file_path: string
          file_size: number
          file_type: string
          uploaded_by?: string | null
          created_at?: string | null
          updated_at?: string | null
          is_active?: boolean | null
          version?: number | null
          document_type_id?: string | null
          quote_id?: string | null
        }
        Update: {
          id?: string
          title?: string
          description?: string | null
          file_name?: string
          file_path?: string
          file_size?: number
          file_type?: string
          uploaded_by?: string | null
          created_at?: string | null
          updated_at?: string | null
          is_active?: boolean | null
          version?: number | null
          document_type_id?: string | null
          quote_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'rams_documents_document_type_id_fkey'
            columns: ['document_type_id']
            isOneToOne: false
            referencedRelation: 'project_document_types'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rams_documents_quote_id_fkey'
            columns: ['quote_id']
            isOneToOne: false
            referencedRelation: 'quotes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rams_documents_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      rams_visitor_signatures: {
        Row: {
          id: string
          rams_document_id: string | null
          visitor_name: string
          visitor_company: string | null
          visitor_role: string | null
          signature_data: string
          signed_at: string | null
          recorded_by: string | null
        }
        Insert: {
          id?: string
          rams_document_id?: string | null
          visitor_name: string
          visitor_company?: string | null
          visitor_role?: string | null
          signature_data: string
          signed_at?: string | null
          recorded_by?: string | null
        }
        Update: {
          id?: string
          rams_document_id?: string | null
          visitor_name?: string
          visitor_company?: string | null
          visitor_role?: string | null
          signature_data?: string
          signed_at?: string | null
          recorded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'rams_visitor_signatures_rams_document_id_fkey'
            columns: ['rams_document_id']
            isOneToOne: false
            referencedRelation: 'rams_documents'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rams_visitor_signatures_recorded_by_fkey'
            columns: ['recorded_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      reminder_actions: {
        Row: {
          id: string
          workflow_key: string
          source_type: 'system_generated' | 'manager_created'
          dedupe_key: string
          status: 'open' | 'resolved' | 'cancelled'
          priority: 'low' | 'medium' | 'high' | 'urgent'
          title: string
          description: string | null
          asset_type: string | null
          van_id: string | null
          plant_id: string | null
          hgv_id: string | null
          metadata: Json
          created_by: string | null
          resolved_by: string | null
          first_detected_at: string
          last_detected_at: string
          resolved_at: string | null
          created_at: string
          updated_at: string
          ignored_until: string | null
          ignored_forever: boolean
          ignored_at: string | null
          ignored_by: string | null
        }
        Insert: {
          id?: string
          workflow_key: string
          source_type?: 'system_generated' | 'manager_created'
          dedupe_key: string
          status?: 'open' | 'resolved' | 'cancelled'
          priority?: 'low' | 'medium' | 'high' | 'urgent'
          title: string
          description?: string | null
          asset_type?: string | null
          van_id?: string | null
          plant_id?: string | null
          hgv_id?: string | null
          metadata?: Json
          created_by?: string | null
          resolved_by?: string | null
          first_detected_at?: string
          last_detected_at?: string
          resolved_at?: string | null
          created_at?: string
          updated_at?: string
          ignored_until?: string | null
          ignored_forever?: boolean
          ignored_at?: string | null
          ignored_by?: string | null
        }
        Update: {
          id?: string
          workflow_key?: string
          source_type?: 'system_generated' | 'manager_created'
          dedupe_key?: string
          status?: 'open' | 'resolved' | 'cancelled'
          priority?: 'low' | 'medium' | 'high' | 'urgent'
          title?: string
          description?: string | null
          asset_type?: string | null
          van_id?: string | null
          plant_id?: string | null
          hgv_id?: string | null
          metadata?: Json
          created_by?: string | null
          resolved_by?: string | null
          first_detected_at?: string
          last_detected_at?: string
          resolved_at?: string | null
          created_at?: string
          updated_at?: string
          ignored_until?: string | null
          ignored_forever?: boolean
          ignored_at?: string | null
          ignored_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'reminder_actions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reminder_actions_hgv_id_fkey'
            columns: ['hgv_id']
            isOneToOne: false
            referencedRelation: 'hgvs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reminder_actions_ignored_by_fkey'
            columns: ['ignored_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reminder_actions_plant_id_fkey'
            columns: ['plant_id']
            isOneToOne: false
            referencedRelation: 'plant'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reminder_actions_resolved_by_fkey'
            columns: ['resolved_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reminder_actions_van_id_fkey'
            columns: ['van_id']
            isOneToOne: false
            referencedRelation: 'vans'
            referencedColumns: ['id']
          },
        ]
      }
      reminder_workflow_settings: {
        Row: {
          workflow_key: string
          is_enabled: boolean
          config: Json
          updated_by: string | null
          created_at: string
          updated_at: string
          last_generated_at: string | null
        }
        Insert: {
          workflow_key: string
          is_enabled?: boolean
          config?: Json
          updated_by?: string | null
          created_at?: string
          updated_at?: string
          last_generated_at?: string | null
        }
        Update: {
          workflow_key?: string
          is_enabled?: boolean
          config?: Json
          updated_by?: string | null
          created_at?: string
          updated_at?: string
          last_generated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'reminder_workflow_settings_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      reminders: {
        Row: {
          id: string
          action_id: string
          assigned_to: string
          assigned_by: string | null
          status: 'pending' | 'actioned' | 'cancelled'
          action_note: string | null
          actioned_at: string | null
          actioned_by: string | null
          cancelled_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          action_id: string
          assigned_to: string
          assigned_by?: string | null
          status?: 'pending' | 'actioned' | 'cancelled'
          action_note?: string | null
          actioned_at?: string | null
          actioned_by?: string | null
          cancelled_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          action_id?: string
          assigned_to?: string
          assigned_by?: string | null
          status?: 'pending' | 'actioned' | 'cancelled'
          action_note?: string | null
          actioned_at?: string | null
          actioned_by?: string | null
          cancelled_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'reminders_action_id_fkey'
            columns: ['action_id']
            isOneToOne: false
            referencedRelation: 'reminder_actions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reminders_actioned_by_fkey'
            columns: ['actioned_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reminders_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reminders_assigned_to_fkey'
            columns: ['assigned_to']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      schedule_employee_assignments: {
        Row: {
          id: string
          job_id: string
          work_date: string
          visit_id: string | null
          profile_id: string
          notes: string | null
          conflict_override: boolean
          conflict_codes: string[]
          conflict_override_by: string | null
          conflict_override_at: string | null
          assigned_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          job_id: string
          work_date: string
          visit_id?: string | null
          profile_id: string
          notes?: string | null
          conflict_override?: boolean
          conflict_codes?: string[]
          conflict_override_by?: string | null
          conflict_override_at?: string | null
          assigned_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          job_id?: string
          work_date?: string
          visit_id?: string | null
          profile_id?: string
          notes?: string | null
          conflict_override?: boolean
          conflict_codes?: string[]
          conflict_override_by?: string | null
          conflict_override_at?: string | null
          assigned_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'schedule_employee_assignments_job_id_fkey'
            columns: ['job_id']
            isOneToOne: false
            referencedRelation: 'schedule_jobs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'schedule_employee_assignments_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'schedule_employee_assignments_visit_id_fkey'
            columns: ['visit_id']
            isOneToOne: false
            referencedRelation: 'schedule_visits'
            referencedColumns: ['id']
          },
        ]
      }
      schedule_job_tag_links: {
        Row: {
          job_id: string
          tag_id: string
          created_by: string | null
          created_at: string
        }
        Insert: {
          job_id: string
          tag_id: string
          created_by?: string | null
          created_at?: string
        }
        Update: {
          job_id?: string
          tag_id?: string
          created_by?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'schedule_job_tag_links_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'schedule_job_tag_links_job_id_fkey'
            columns: ['job_id']
            isOneToOne: false
            referencedRelation: 'schedule_jobs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'schedule_job_tag_links_tag_id_fkey'
            columns: ['tag_id']
            isOneToOne: false
            referencedRelation: 'schedule_job_tags'
            referencedColumns: ['id']
          },
        ]
      }
      schedule_job_tags: {
        Row: {
          id: string
          name: string
          color: string
          description: string | null
          is_active: boolean
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          color?: string
          description?: string | null
          is_active?: boolean
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          color?: string
          description?: string | null
          is_active?: boolean
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'schedule_job_tags_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'schedule_job_tags_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      schedule_jobs: {
        Row: {
          id: string
          job_reference: string
          title: string
          description: string | null
          site_address: string | null
          status: 'draft' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
          source_type: 'sample' | 'manual' | 'quote'
          start_date: string
          end_date: string
          estimated_duration_minutes: number | null
          quote_id: string | null
          quote_project_number_id: string | null
          customer_id: string | null
          customer_site_id: string | null
          is_drop_on_ready: boolean
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          job_reference: string
          title: string
          description?: string | null
          site_address?: string | null
          status?: 'draft' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
          source_type?: 'sample' | 'manual' | 'quote'
          start_date: string
          end_date: string
          estimated_duration_minutes?: number | null
          quote_id?: string | null
          quote_project_number_id?: string | null
          customer_id?: string | null
          customer_site_id?: string | null
          is_drop_on_ready?: boolean
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          job_reference?: string
          title?: string
          description?: string | null
          site_address?: string | null
          status?: 'draft' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
          source_type?: 'sample' | 'manual' | 'quote'
          start_date?: string
          end_date?: string
          estimated_duration_minutes?: number | null
          quote_id?: string | null
          quote_project_number_id?: string | null
          customer_id?: string | null
          customer_site_id?: string | null
          is_drop_on_ready?: boolean
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'schedule_jobs_customer_id_fkey'
            columns: ['customer_id']
            isOneToOne: false
            referencedRelation: 'customers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'schedule_jobs_customer_site_id_fkey'
            columns: ['customer_site_id']
            isOneToOne: false
            referencedRelation: 'customer_sites'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'schedule_jobs_quote_id_fkey'
            columns: ['quote_id']
            isOneToOne: false
            referencedRelation: 'quotes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'schedule_jobs_quote_project_number_id_fkey'
            columns: ['quote_project_number_id']
            isOneToOne: false
            referencedRelation: 'quote_project_numbers'
            referencedColumns: ['id']
          },
        ]
      }
      schedule_plant_assignments: {
        Row: {
          id: string
          job_id: string
          work_date: string
          visit_id: string | null
          plant_id: string
          notes: string | null
          conflict_override: boolean
          conflict_codes: string[]
          conflict_override_by: string | null
          conflict_override_at: string | null
          assigned_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          job_id: string
          work_date: string
          visit_id?: string | null
          plant_id: string
          notes?: string | null
          conflict_override?: boolean
          conflict_codes?: string[]
          conflict_override_by?: string | null
          conflict_override_at?: string | null
          assigned_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          job_id?: string
          work_date?: string
          visit_id?: string | null
          plant_id?: string
          notes?: string | null
          conflict_override?: boolean
          conflict_codes?: string[]
          conflict_override_by?: string | null
          conflict_override_at?: string | null
          assigned_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'schedule_plant_assignments_job_id_fkey'
            columns: ['job_id']
            isOneToOne: false
            referencedRelation: 'schedule_jobs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'schedule_plant_assignments_plant_id_fkey'
            columns: ['plant_id']
            isOneToOne: false
            referencedRelation: 'plant'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'schedule_plant_assignments_visit_id_fkey'
            columns: ['visit_id']
            isOneToOne: false
            referencedRelation: 'schedule_visits'
            referencedColumns: ['id']
          },
        ]
      }
      schedule_visits: {
        Row: {
          id: string
          job_id: string
          sequence_number: number
          title: string | null
          starts_at: string
          ends_at: string
          status: 'planned' | 'completed' | 'cancelled'
          notes: string | null
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          job_id: string
          sequence_number?: number
          title?: string | null
          starts_at: string
          ends_at: string
          status?: 'planned' | 'completed' | 'cancelled'
          notes?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          job_id?: string
          sequence_number?: number
          title?: string | null
          starts_at?: string
          ends_at?: string
          status?: 'planned' | 'completed' | 'cancelled'
          notes?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'schedule_visits_job_id_fkey'
            columns: ['job_id']
            isOneToOne: false
            referencedRelation: 'schedule_jobs'
            referencedColumns: ['id']
          },
        ]
      }
      schedule_plant_unavailability: {
        Row: {
          id: string
          plant_id: string
          start_date: string
          end_date: string
          reason: string
          notes: string | null
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          plant_id: string
          start_date: string
          end_date: string
          reason: string
          notes?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          plant_id?: string
          start_date?: string
          end_date?: string
          reason?: string
          notes?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'schedule_plant_unavailability_plant_id_fkey'
            columns: ['plant_id']
            isOneToOne: false
            referencedRelation: 'plant'
            referencedColumns: ['id']
          },
        ]
      }
      role_permissions: {
        Row: {
          id: string
          role_id: string | null
          module_name: string
          enabled: boolean | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          role_id?: string | null
          module_name: string
          enabled?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          role_id?: string | null
          module_name?: string
          enabled?: boolean | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'role_permissions_role_id_fkey'
            columns: ['role_id']
            isOneToOne: false
            referencedRelation: 'roles'
            referencedColumns: ['id']
          },
        ]
      }
      roles: {
        Row: {
          id: string
          name: string
          display_name: string
          description: string | null
          is_super_admin: boolean | null
          is_manager_admin: boolean | null
          created_at: string | null
          updated_at: string | null
          timesheet_type: 'civils' | 'plant' | null
          role_class: 'admin' | 'manager' | 'employee'
          hierarchy_rank: number | null
        }
        Insert: {
          id?: string
          name: string
          display_name: string
          description?: string | null
          is_super_admin?: boolean | null
          is_manager_admin?: boolean | null
          created_at?: string | null
          updated_at?: string | null
          timesheet_type?: 'civils' | 'plant' | null
          role_class?: 'admin' | 'manager' | 'employee'
          hierarchy_rank?: number | null
        }
        Update: {
          id?: string
          name?: string
          display_name?: string
          description?: string | null
          is_super_admin?: boolean | null
          is_manager_admin?: boolean | null
          created_at?: string | null
          updated_at?: string | null
          timesheet_type?: 'civils' | 'plant' | null
          role_class?: 'admin' | 'manager' | 'employee'
          hierarchy_rank?: number | null
        }
        Relationships: [
        ]
      }
      sensitive_pin_audit_events: {
        Row: {
          id: string
          profile_id: string | null
          actor_profile_id: string | null
          event_type: 'setup_requested' | 'setup_confirmed' | 'change_requested' | 'change_confirmed' | 'reset_requested' | 'reset_confirmed' | 'admin_reset' | 'unlock_success' | 'unlock_failed' | 'pin_locked'
          module_name: string | null
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          profile_id?: string | null
          actor_profile_id?: string | null
          event_type: 'setup_requested' | 'setup_confirmed' | 'change_requested' | 'change_confirmed' | 'reset_requested' | 'reset_confirmed' | 'admin_reset' | 'unlock_success' | 'unlock_failed' | 'pin_locked'
          module_name?: string | null
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          profile_id?: string | null
          actor_profile_id?: string | null
          event_type?: 'setup_requested' | 'setup_confirmed' | 'change_requested' | 'change_confirmed' | 'reset_requested' | 'reset_confirmed' | 'admin_reset' | 'unlock_success' | 'unlock_failed' | 'pin_locked'
          module_name?: string | null
          metadata?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'sensitive_pin_audit_events_actor_profile_id_fkey'
            columns: ['actor_profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sensitive_pin_audit_events_module_name_fkey'
            columns: ['module_name']
            isOneToOne: false
            referencedRelation: 'permission_modules'
            referencedColumns: ['module_name']
          },
          {
            foreignKeyName: 'sensitive_pin_audit_events_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      sensitive_pin_unlocks: {
        Row: {
          id: string
          profile_id: string
          session_id: string
          module_name: string
          unlocked_at: string
          expires_at: string
          created_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          session_id: string
          module_name: string
          unlocked_at?: string
          expires_at: string
          created_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          session_id?: string
          module_name?: string
          unlocked_at?: string
          expires_at?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'sensitive_pin_unlocks_module_name_fkey'
            columns: ['module_name']
            isOneToOne: false
            referencedRelation: 'permission_modules'
            referencedColumns: ['module_name']
          },
          {
            foreignKeyName: 'sensitive_pin_unlocks_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sensitive_pin_unlocks_session_id_fkey'
            columns: ['session_id']
            isOneToOne: false
            referencedRelation: 'app_auth_sessions'
            referencedColumns: ['id']
          },
        ]
      }
      sensitive_pin_verification_tokens: {
        Row: {
          id: string
          profile_id: string
          token_hash: string
          purpose: 'setup' | 'change' | 'reset'
          pending_pin_hash: string
          pending_pin_salt: string
          pending_pin_length: 4 | 6
          attempts: number
          expires_at: string
          consumed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          token_hash: string
          purpose: 'setup' | 'change' | 'reset'
          pending_pin_hash: string
          pending_pin_salt: string
          pending_pin_length: 4 | 6
          attempts?: number
          expires_at: string
          consumed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          token_hash?: string
          purpose?: 'setup' | 'change' | 'reset'
          pending_pin_hash?: string
          pending_pin_salt?: string
          pending_pin_length?: 4 | 6
          attempts?: number
          expires_at?: string
          consumed_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'sensitive_pin_verification_tokens_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      service_health_events: {
        Row: {
          id: string
          service: string
          status: 'active' | 'recovered'
          outage_started_at: string
          outage_last_seen_at: string
          recovered_at: string | null
          recovery_error_log_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          service: string
          status?: 'active' | 'recovered'
          outage_started_at: string
          outage_last_seen_at: string
          recovered_at?: string | null
          recovery_error_log_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          service?: string
          status?: 'active' | 'recovered'
          outage_started_at?: string
          outage_last_seen_at?: string
          recovered_at?: string | null
          recovery_error_log_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'service_health_events_recovery_error_log_id_fkey'
            columns: ['recovery_error_log_id']
            isOneToOne: false
            referencedRelation: 'error_logs'
            referencedColumns: ['id']
          },
        ]
      }
      suggestion_updates: {
        Row: {
          id: string
          suggestion_id: string
          created_by: string
          old_status: string | null
          new_status: string | null
          note: string | null
          created_at: string | null
        }
        Insert: {
          id?: string
          suggestion_id: string
          created_by: string
          old_status?: string | null
          new_status?: string | null
          note?: string | null
          created_at?: string | null
        }
        Update: {
          id?: string
          suggestion_id?: string
          created_by?: string
          old_status?: string | null
          new_status?: string | null
          note?: string | null
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'suggestion_updates_suggestion_id_fkey'
            columns: ['suggestion_id']
            isOneToOne: false
            referencedRelation: 'suggestions'
            referencedColumns: ['id']
          },
        ]
      }
      suggestions: {
        Row: {
          id: string
          created_by: string
          title: string
          body: string
          page_hint: string | null
          status: 'new' | 'under_review' | 'planned' | 'completed' | 'declined' | null
          admin_notes: string | null
          created_at: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          created_by: string
          title: string
          body: string
          page_hint?: string | null
          status?: 'new' | 'under_review' | 'planned' | 'completed' | 'declined' | null
          admin_notes?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          created_by?: string
          title?: string
          body?: string
          page_hint?: string | null
          status?: 'new' | 'under_review' | 'planned' | 'completed' | 'declined' | null
          admin_notes?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
        ]
      }
      team_module_permissions: {
        Row: {
          team_id: string
          module_name: string
          enabled: boolean
          created_at: string
          updated_at: string
          access_level: number
        }
        Insert: {
          team_id: string
          module_name: string
          enabled?: boolean
          created_at?: string
          updated_at?: string
          access_level?: number
        }
        Update: {
          team_id?: string
          module_name?: string
          enabled?: boolean
          created_at?: string
          updated_at?: string
          access_level?: number
        }
        Relationships: [
          {
            foreignKeyName: 'team_module_permissions_module_name_fkey'
            columns: ['module_name']
            isOneToOne: false
            referencedRelation: 'permission_modules'
            referencedColumns: ['module_name']
          },
          {
            foreignKeyName: 'team_module_permissions_team_id_fkey'
            columns: ['team_id']
            isOneToOne: false
            referencedRelation: 'org_teams'
            referencedColumns: ['id']
          },
        ]
      }
      timesheet_entries: {
        Row: {
          id: string
          timesheet_id: string
          day_of_week: number
          time_started: string | null
          time_finished: string | null
          working_in_yard: boolean | null
          subsistence_payment_required: boolean
          daily_total: number | null
          remarks: string | null
          created_at: string | null
          updated_at: string | null
          did_not_work: boolean
          job_number: string | null
          night_shift: boolean | null
          bank_holiday: boolean | null
          operator_travel_hours: number | null
          operator_yard_hours: number | null
          operator_working_hours: number | null
          machine_travel_hours: number | null
          machine_start_time: string | null
          machine_finish_time: string | null
          machine_working_hours: number | null
          machine_standing_hours: number | null
          machine_operator_hours: number | null
          maintenance_breakdown_hours: number | null
        }
        Insert: {
          id?: string
          timesheet_id: string
          day_of_week: number
          time_started?: string | null
          time_finished?: string | null
          working_in_yard?: boolean | null
          subsistence_payment_required?: boolean
          daily_total?: number | null
          remarks?: string | null
          created_at?: string | null
          updated_at?: string | null
          did_not_work?: boolean
          job_number?: string | null
          night_shift?: boolean | null
          bank_holiday?: boolean | null
          operator_travel_hours?: number | null
          operator_yard_hours?: number | null
          operator_working_hours?: number | null
          machine_travel_hours?: number | null
          machine_start_time?: string | null
          machine_finish_time?: string | null
          machine_working_hours?: number | null
          machine_standing_hours?: number | null
          machine_operator_hours?: number | null
          maintenance_breakdown_hours?: number | null
        }
        Update: {
          id?: string
          timesheet_id?: string
          day_of_week?: number
          time_started?: string | null
          time_finished?: string | null
          working_in_yard?: boolean | null
          subsistence_payment_required?: boolean
          daily_total?: number | null
          remarks?: string | null
          created_at?: string | null
          updated_at?: string | null
          did_not_work?: boolean
          job_number?: string | null
          night_shift?: boolean | null
          bank_holiday?: boolean | null
          operator_travel_hours?: number | null
          operator_yard_hours?: number | null
          operator_working_hours?: number | null
          machine_travel_hours?: number | null
          machine_start_time?: string | null
          machine_finish_time?: string | null
          machine_working_hours?: number | null
          machine_standing_hours?: number | null
          machine_operator_hours?: number | null
          maintenance_breakdown_hours?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'timesheet_entries_timesheet_id_fkey'
            columns: ['timesheet_id']
            isOneToOne: false
            referencedRelation: 'timesheets'
            referencedColumns: ['id']
          },
        ]
      }
      timesheet_entry_job_codes: {
        Row: {
          id: string
          timesheet_entry_id: string
          job_number: string
          display_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          timesheet_entry_id: string
          job_number: string
          display_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          timesheet_entry_id?: string
          job_number?: string
          display_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'timesheet_entry_job_codes_timesheet_entry_id_fkey'
            columns: ['timesheet_entry_id']
            isOneToOne: false
            referencedRelation: 'timesheet_entries'
            referencedColumns: ['id']
          },
        ]
      }
      timesheet_entry_leave_snapshots: {
        Row: {
          id: string
          absence_id: string
          timesheet_id: string
          timesheet_entry_id: string
          day_of_week: number
          had_entry: boolean
          original_entry: Json | null
          original_job_numbers: string[]
          applied_entry: Json
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          absence_id: string
          timesheet_id: string
          timesheet_entry_id: string
          day_of_week: number
          had_entry?: boolean
          original_entry?: Json | null
          original_job_numbers?: string[]
          applied_entry: Json
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          absence_id?: string
          timesheet_id?: string
          timesheet_entry_id?: string
          day_of_week?: number
          had_entry?: boolean
          original_entry?: Json | null
          original_job_numbers?: string[]
          applied_entry?: Json
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'timesheet_entry_leave_snapshots_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'timesheet_entry_leave_snapshots_timesheet_entry_id_fkey'
            columns: ['timesheet_entry_id']
            isOneToOne: false
            referencedRelation: 'timesheet_entries'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'timesheet_entry_leave_snapshots_timesheet_id_fkey'
            columns: ['timesheet_id']
            isOneToOne: false
            referencedRelation: 'timesheets'
            referencedColumns: ['id']
          },
        ]
      }
      timesheet_type_exceptions: {
        Row: {
          profile_id: string
          timesheet_type: string | null
          created_at: string
          updated_at: string
          created_by: string | null
          updated_by: string | null
        }
        Insert: {
          profile_id: string
          timesheet_type?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Update: {
          profile_id?: string
          timesheet_type?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'timesheet_type_exceptions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'timesheet_type_exceptions_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'timesheet_type_exceptions_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      timesheets: {
        Row: {
          id: string
          user_id: string
          reg_number: string | null
          week_ending: string
          status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'processed' | 'adjusted' | null
          signature_data: string | null
          signed_at: string | null
          submitted_at: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          manager_comments: string | null
          created_at: string | null
          updated_at: string | null
          adjusted_by: string | null
          adjusted_at: string | null
          adjustment_recipients: string[] | null
          processed_at: string | null
          timesheet_type: 'civils' | 'plant' | null
          template_version: 1 | 2
          site_address: string | null
          hirer_name: string | null
          is_hired_plant: boolean | null
          hired_plant_id_serial: string | null
          hired_plant_description: string | null
          hired_plant_hiring_company: string | null
        }
        Insert: {
          id?: string
          user_id: string
          reg_number?: string | null
          week_ending: string
          status?: 'draft' | 'submitted' | 'approved' | 'rejected' | 'processed' | 'adjusted' | null
          signature_data?: string | null
          signed_at?: string | null
          submitted_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          manager_comments?: string | null
          created_at?: string | null
          updated_at?: string | null
          adjusted_by?: string | null
          adjusted_at?: string | null
          adjustment_recipients?: string[] | null
          processed_at?: string | null
          timesheet_type?: 'civils' | 'plant' | null
          template_version?: 1 | 2
          site_address?: string | null
          hirer_name?: string | null
          is_hired_plant?: boolean | null
          hired_plant_id_serial?: string | null
          hired_plant_description?: string | null
          hired_plant_hiring_company?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          reg_number?: string | null
          week_ending?: string
          status?: 'draft' | 'submitted' | 'approved' | 'rejected' | 'processed' | 'adjusted' | null
          signature_data?: string | null
          signed_at?: string | null
          submitted_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          manager_comments?: string | null
          created_at?: string | null
          updated_at?: string | null
          adjusted_by?: string | null
          adjusted_at?: string | null
          adjustment_recipients?: string[] | null
          processed_at?: string | null
          timesheet_type?: 'civils' | 'plant' | null
          template_version?: 1 | 2
          site_address?: string | null
          hirer_name?: string | null
          is_hired_plant?: boolean | null
          hired_plant_id_serial?: string | null
          hired_plant_description?: string | null
          hired_plant_hiring_company?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'timesheets_adjusted_by_fkey'
            columns: ['adjusted_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'timesheets_reviewed_by_fkey'
            columns: ['reviewed_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'timesheets_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      training_import_batches: {
        Row: {
          id: string
          source_file: string
          source_hash: string
          imported_at: string
          record_count: number
          people_count: number
          qualification_count: number
          workbook_note_count: number
          likely_misc_note_count: number
          rules: Json
          metadata: Json
          created_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          source_file: string
          source_hash: string
          imported_at?: string
          record_count?: number
          people_count?: number
          qualification_count?: number
          workbook_note_count?: number
          likely_misc_note_count?: number
          rules?: Json
          metadata?: Json
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          source_file?: string
          source_hash?: string
          imported_at?: string
          record_count?: number
          people_count?: number
          qualification_count?: number
          workbook_note_count?: number
          likely_misc_note_count?: number
          rules?: Json
          metadata?: Json
          created_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'training_import_batches_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      training_people: {
        Row: {
          id: string
          employee_key: string
          employee_name_raw: string
          profile_id: string | null
          profile_match_status: 'matched' | 'ambiguous' | 'unmatched' | 'not_attempted'
          profile_match_notes: string | null
          date_of_births: string[]
          source_sheets: string[]
          record_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          employee_key: string
          employee_name_raw: string
          profile_id?: string | null
          profile_match_status?: 'matched' | 'ambiguous' | 'unmatched' | 'not_attempted'
          profile_match_notes?: string | null
          date_of_births?: string[]
          source_sheets?: string[]
          record_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          employee_key?: string
          employee_name_raw?: string
          profile_id?: string | null
          profile_match_status?: 'matched' | 'ambiguous' | 'unmatched' | 'not_attempted'
          profile_match_notes?: string | null
          date_of_births?: string[]
          source_sheets?: string[]
          record_count?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'training_people_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      training_qualifications: {
        Row: {
          id: string
          qualification_key: string
          qualification_raw: string
          canonical_name: string
          validation_status: 'needs_manual_review' | 'plant_category_or_card_scheme' | 'standardised_or_spelling_corrected' | 'note_or_status_mixed_with_qualification'
          validation_notes: string | null
          source_sheets: string[]
          record_count: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          qualification_key: string
          qualification_raw: string
          canonical_name: string
          validation_status: 'needs_manual_review' | 'plant_category_or_card_scheme' | 'standardised_or_spelling_corrected' | 'note_or_status_mixed_with_qualification'
          validation_notes?: string | null
          source_sheets?: string[]
          record_count?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          qualification_key?: string
          qualification_raw?: string
          canonical_name?: string
          validation_status?: 'needs_manual_review' | 'plant_category_or_card_scheme' | 'standardised_or_spelling_corrected' | 'note_or_status_mixed_with_qualification'
          validation_notes?: string | null
          source_sheets?: string[]
          record_count?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      training_records: {
        Row: {
          id: string
          source_record_id: string
          import_batch_id: string | null
          person_id: string | null
          qualification_id: string | null
          employee_name_raw: string | null
          qualification_raw: string
          qualification_canonical_proposed: string
          qualification_validation_status: 'needs_manual_review' | 'plant_category_or_card_scheme' | 'standardised_or_spelling_corrected' | 'note_or_status_mixed_with_qualification'
          qualification_group: string | null
          relationship: string | null
          card_number: string | null
          card_type_or_status: string | null
          approved: string | null
          issue_date: string | null
          issue_raw: string | null
          expiry_date: string | null
          expiry_raw: string | null
          date_of_birth: string | null
          date_of_birth_raw: string | null
          comments: string | null
          additional_comments: string | null
          rebooked: string | null
          cpcs_statuses: string[]
          cpcs_status_meanings: string[]
          cpcs_source_fill_colours: string[]
          colour_formatting_ignored: boolean
          colour_formatting_rule: string | null
          source_sheet: string
          source_row: number
          record_status: 'active' | 'archived'
          next_review_at: string | null
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          source_record_id: string
          import_batch_id?: string | null
          person_id?: string | null
          qualification_id?: string | null
          employee_name_raw?: string | null
          qualification_raw: string
          qualification_canonical_proposed: string
          qualification_validation_status: 'needs_manual_review' | 'plant_category_or_card_scheme' | 'standardised_or_spelling_corrected' | 'note_or_status_mixed_with_qualification'
          qualification_group?: string | null
          relationship?: string | null
          card_number?: string | null
          card_type_or_status?: string | null
          approved?: string | null
          issue_date?: string | null
          issue_raw?: string | null
          expiry_date?: string | null
          expiry_raw?: string | null
          date_of_birth?: string | null
          date_of_birth_raw?: string | null
          comments?: string | null
          additional_comments?: string | null
          rebooked?: string | null
          cpcs_statuses?: string[]
          cpcs_status_meanings?: string[]
          cpcs_source_fill_colours?: string[]
          colour_formatting_ignored?: boolean
          colour_formatting_rule?: string | null
          source_sheet: string
          source_row: number
          record_status?: 'active' | 'archived'
          next_review_at?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          source_record_id?: string
          import_batch_id?: string | null
          person_id?: string | null
          qualification_id?: string | null
          employee_name_raw?: string | null
          qualification_raw?: string
          qualification_canonical_proposed?: string
          qualification_validation_status?: 'needs_manual_review' | 'plant_category_or_card_scheme' | 'standardised_or_spelling_corrected' | 'note_or_status_mixed_with_qualification'
          qualification_group?: string | null
          relationship?: string | null
          card_number?: string | null
          card_type_or_status?: string | null
          approved?: string | null
          issue_date?: string | null
          issue_raw?: string | null
          expiry_date?: string | null
          expiry_raw?: string | null
          date_of_birth?: string | null
          date_of_birth_raw?: string | null
          comments?: string | null
          additional_comments?: string | null
          rebooked?: string | null
          cpcs_statuses?: string[]
          cpcs_status_meanings?: string[]
          cpcs_source_fill_colours?: string[]
          colour_formatting_ignored?: boolean
          colour_formatting_rule?: string | null
          source_sheet?: string
          source_row?: number
          record_status?: 'active' | 'archived'
          next_review_at?: string | null
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'training_records_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'training_records_import_batch_id_fkey'
            columns: ['import_batch_id']
            isOneToOne: false
            referencedRelation: 'training_import_batches'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'training_records_person_id_fkey'
            columns: ['person_id']
            isOneToOne: false
            referencedRelation: 'training_people'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'training_records_qualification_id_fkey'
            columns: ['qualification_id']
            isOneToOne: false
            referencedRelation: 'training_qualifications'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'training_records_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      training_workbook_notes: {
        Row: {
          id: string
          import_batch_id: string | null
          note_type: 'workbook_note' | 'likely_misc_note'
          source_sheet: string
          cell_address: string
          source_row: number | null
          source_column: number | null
          note_value: string
          fill_colour: string | null
          reason: string | null
          created_at: string
        }
        Insert: {
          id?: string
          import_batch_id?: string | null
          note_type: 'workbook_note' | 'likely_misc_note'
          source_sheet: string
          cell_address: string
          source_row?: number | null
          source_column?: number | null
          note_value: string
          fill_colour?: string | null
          reason?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          import_batch_id?: string | null
          note_type?: 'workbook_note' | 'likely_misc_note'
          source_sheet?: string
          cell_address?: string
          source_row?: number | null
          source_column?: number | null
          note_value?: string
          fill_colour?: string | null
          reason?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'training_workbook_notes_import_batch_id_fkey'
            columns: ['import_batch_id']
            isOneToOne: false
            referencedRelation: 'training_import_batches'
            referencedColumns: ['id']
          },
        ]
      }
      user_module_permissions: {
        Row: {
          user_id: string
          module_name: string
          access_level: number
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          module_name: string
          access_level: number
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          user_id?: string
          module_name?: string
          access_level?: number
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_module_permissions_module_name_fkey'
            columns: ['module_name']
            isOneToOne: false
            referencedRelation: 'permission_modules'
            referencedColumns: ['module_name']
          },
          {
            foreignKeyName: 'user_module_permissions_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_module_permissions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      user_page_visits: {
        Row: {
          id: string
          user_id: string
          path: string
          visited_at: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          path: string
          visited_at?: string
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          path?: string
          visited_at?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_page_visits_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      user_usage_daily_rollups: {
        Row: {
          id: string
          rollup_date: string
          module: string | null
          event_name: string
          event_category: string
          role_id: string | null
          team_id: string | null
          device_type: string | null
          total_events: number
          unique_users: number
          session_count: number
          page_view_count: number
          avg_duration_ms: number | null
          first_event_at: string | null
          last_event_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          rollup_date: string
          module?: string | null
          event_name: string
          event_category: string
          role_id?: string | null
          team_id?: string | null
          device_type?: string | null
          total_events?: number
          unique_users?: number
          session_count?: number
          page_view_count?: number
          avg_duration_ms?: number | null
          first_event_at?: string | null
          last_event_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          rollup_date?: string
          module?: string | null
          event_name?: string
          event_category?: string
          role_id?: string | null
          team_id?: string | null
          device_type?: string | null
          total_events?: number
          unique_users?: number
          session_count?: number
          page_view_count?: number
          avg_duration_ms?: number | null
          first_event_at?: string | null
          last_event_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_usage_daily_rollups_role_id_fkey'
            columns: ['role_id']
            isOneToOne: false
            referencedRelation: 'roles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_usage_daily_rollups_team_id_fkey'
            columns: ['team_id']
            isOneToOne: false
            referencedRelation: 'org_teams'
            referencedColumns: ['id']
          },
        ]
      }
      user_usage_events: {
        Row: {
          id: string
          session_id: string | null
          user_id: string | null
          app_session_id: string | null
          client_session_id: string | null
          client_event_id: string | null
          occurred_at: string
          received_at: string
          event_name: 'session_started' | 'session_heartbeat' | 'session_ended' | 'page_view' | 'route_changed' | 'visibility_resume' | 'auth_login_success' | 'auth_login_failed' | 'auth_logout' | 'error_observed'
          event_category: 'session' | 'navigation' | 'auth' | 'error' | 'performance'
          module: string | null
          path: string | null
          normalized_path: string | null
          referrer_path: string | null
          event_source: 'client' | 'server'
          duration_ms: number | null
          related_record_type: string | null
          related_record_id: string | null
          error_log_id: string | null
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          session_id?: string | null
          user_id?: string | null
          app_session_id?: string | null
          client_session_id?: string | null
          client_event_id?: string | null
          occurred_at?: string
          received_at?: string
          event_name: 'session_started' | 'session_heartbeat' | 'session_ended' | 'page_view' | 'route_changed' | 'visibility_resume' | 'auth_login_success' | 'auth_login_failed' | 'auth_logout' | 'error_observed'
          event_category: 'session' | 'navigation' | 'auth' | 'error' | 'performance'
          module?: string | null
          path?: string | null
          normalized_path?: string | null
          referrer_path?: string | null
          event_source?: 'client' | 'server'
          duration_ms?: number | null
          related_record_type?: string | null
          related_record_id?: string | null
          error_log_id?: string | null
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          session_id?: string | null
          user_id?: string | null
          app_session_id?: string | null
          client_session_id?: string | null
          client_event_id?: string | null
          occurred_at?: string
          received_at?: string
          event_name?: 'session_started' | 'session_heartbeat' | 'session_ended' | 'page_view' | 'route_changed' | 'visibility_resume' | 'auth_login_success' | 'auth_login_failed' | 'auth_logout' | 'error_observed'
          event_category?: 'session' | 'navigation' | 'auth' | 'error' | 'performance'
          module?: string | null
          path?: string | null
          normalized_path?: string | null
          referrer_path?: string | null
          event_source?: 'client' | 'server'
          duration_ms?: number | null
          related_record_type?: string | null
          related_record_id?: string | null
          error_log_id?: string | null
          metadata?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_usage_events_app_session_id_fkey'
            columns: ['app_session_id']
            isOneToOne: false
            referencedRelation: 'app_auth_sessions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_usage_events_error_log_id_fkey'
            columns: ['error_log_id']
            isOneToOne: false
            referencedRelation: 'error_logs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_usage_events_session_id_fkey'
            columns: ['session_id']
            isOneToOne: false
            referencedRelation: 'user_usage_sessions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_usage_events_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      user_usage_retention_runs: {
        Row: {
          id: string
          started_at: string
          completed_at: string | null
          status: 'running' | 'completed' | 'failed'
          raw_retention_days: number
          cutoff_at: string
          rollups_refreshed: number
          events_deleted: number
          sessions_deleted: number
          error_message: string | null
          created_at: string
        }
        Insert: {
          id?: string
          started_at?: string
          completed_at?: string | null
          status?: 'running' | 'completed' | 'failed'
          raw_retention_days?: number
          cutoff_at: string
          rollups_refreshed?: number
          events_deleted?: number
          sessions_deleted?: number
          error_message?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          started_at?: string
          completed_at?: string | null
          status?: 'running' | 'completed' | 'failed'
          raw_retention_days?: number
          cutoff_at?: string
          rollups_refreshed?: number
          events_deleted?: number
          sessions_deleted?: number
          error_message?: string | null
          created_at?: string
        }
        Relationships: [
        ]
      }
      user_usage_sessions: {
        Row: {
          id: string
          user_id: string | null
          app_session_id: string | null
          client_session_id: string
          first_seen_at: string
          last_seen_at: string
          ended_at: string | null
          entry_path: string | null
          exit_path: string | null
          referrer_path: string | null
          user_agent: string | null
          browser_name: string | null
          browser_version: string | null
          os_name: string | null
          device_type: 'desktop' | 'mobile' | 'tablet' | 'unknown' | null
          viewport_width: number | null
          viewport_height: number | null
          locale: string | null
          timezone: string | null
          event_count: number
          page_view_count: number
          heartbeat_count: number
          duration_seconds: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id?: string | null
          app_session_id?: string | null
          client_session_id: string
          first_seen_at?: string
          last_seen_at?: string
          ended_at?: string | null
          entry_path?: string | null
          exit_path?: string | null
          referrer_path?: string | null
          user_agent?: string | null
          browser_name?: string | null
          browser_version?: string | null
          os_name?: string | null
          device_type?: 'desktop' | 'mobile' | 'tablet' | 'unknown' | null
          viewport_width?: number | null
          viewport_height?: number | null
          locale?: string | null
          timezone?: string | null
          event_count?: number
          page_view_count?: number
          heartbeat_count?: number
          duration_seconds?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string | null
          app_session_id?: string | null
          client_session_id?: string
          first_seen_at?: string
          last_seen_at?: string
          ended_at?: string | null
          entry_path?: string | null
          exit_path?: string | null
          referrer_path?: string | null
          user_agent?: string | null
          browser_name?: string | null
          browser_version?: string | null
          os_name?: string | null
          device_type?: 'desktop' | 'mobile' | 'tablet' | 'unknown' | null
          viewport_width?: number | null
          viewport_height?: number | null
          locale?: string | null
          timezone?: string | null
          event_count?: number
          page_view_count?: number
          heartbeat_count?: number
          duration_seconds?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'user_usage_sessions_app_session_id_fkey'
            columns: ['app_session_id']
            isOneToOne: false
            referencedRelation: 'app_auth_sessions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'user_usage_sessions_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      van_archive: {
        Row: {
          id: string
          van_id: string
          reg_number: string | null
          category_id: string | null
          status: string | null
          archive_reason: 'Sold' | 'Scrapped' | 'Other'
          archive_comment: string | null
          archived_by: string | null
          archived_at: string | null
          vehicle_data: Json
          maintenance_data: Json | null
          created_at: string | null
          plant_id: string | null
          asset_type: string | null
          serial_number: string | null
          year: number | null
          weight_class: string | null
        }
        Insert: {
          id?: string
          van_id: string
          reg_number?: string | null
          category_id?: string | null
          status?: string | null
          archive_reason: 'Sold' | 'Scrapped' | 'Other'
          archive_comment?: string | null
          archived_by?: string | null
          archived_at?: string | null
          vehicle_data: Json
          maintenance_data?: Json | null
          created_at?: string | null
          plant_id?: string | null
          asset_type?: string | null
          serial_number?: string | null
          year?: number | null
          weight_class?: string | null
        }
        Update: {
          id?: string
          van_id?: string
          reg_number?: string | null
          category_id?: string | null
          status?: string | null
          archive_reason?: 'Sold' | 'Scrapped' | 'Other'
          archive_comment?: string | null
          archived_by?: string | null
          archived_at?: string | null
          vehicle_data?: Json
          maintenance_data?: Json | null
          created_at?: string | null
          plant_id?: string | null
          asset_type?: string | null
          serial_number?: string | null
          year?: number | null
          weight_class?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'van_archive_archived_by_fkey'
            columns: ['archived_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      van_categories: {
        Row: {
          id: string
          name: string
          description: string | null
          created_at: string | null
          updated_at: string | null
          applies_to: string[]
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          created_at?: string | null
          updated_at?: string | null
          applies_to?: string[]
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          created_at?: string | null
          updated_at?: string | null
          applies_to?: string[]
        }
        Relationships: [
        ]
      }
      van_inspection_daily_duplicate_archive: {
        Row: {
          id: string
          old_inspection_id: string
          original_day_of_week: number
          target_date: string
          kept_inspection_id: string
          inspection_snapshot: Json
          items_snapshot: Json
          photos_snapshot: Json
          actions_snapshot: Json
          archived_reason: string
          archived_at: string
        }
        Insert: {
          id?: string
          old_inspection_id: string
          original_day_of_week: number
          target_date: string
          kept_inspection_id: string
          inspection_snapshot: Json
          items_snapshot?: Json
          photos_snapshot?: Json
          actions_snapshot?: Json
          archived_reason?: string
          archived_at?: string
        }
        Update: {
          id?: string
          old_inspection_id?: string
          original_day_of_week?: number
          target_date?: string
          kept_inspection_id?: string
          inspection_snapshot?: Json
          items_snapshot?: Json
          photos_snapshot?: Json
          actions_snapshot?: Json
          archived_reason?: string
          archived_at?: string
        }
        Relationships: [
        ]
      }
      van_inspection_daily_split_map: {
        Row: {
          id: string
          old_inspection_id: string
          original_day_of_week: number
          new_inspection_id: string
          old_item_id: string | null
          new_item_id: string | null
          migrated_at: string
        }
        Insert: {
          id?: string
          old_inspection_id: string
          original_day_of_week: number
          new_inspection_id: string
          old_item_id?: string | null
          new_item_id?: string | null
          migrated_at?: string
        }
        Update: {
          id?: string
          old_inspection_id?: string
          original_day_of_week?: number
          new_inspection_id?: string
          old_item_id?: string | null
          new_item_id?: string | null
          migrated_at?: string
        }
        Relationships: [
        ]
      }
      van_inspections: {
        Row: {
          id: string
          van_id: string | null
          user_id: string
          inspection_date: string
          status: 'draft' | 'submitted' | null
          submitted_at: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          created_at: string | null
          updated_at: string | null
          manager_comments: string | null
          inspection_end_date: string | null
          signature_data: string | null
          signed_at: string | null
          current_mileage: number | null
          inspector_comments: string | null
          plant_id: string | null
          is_hired_plant: boolean
          hired_plant_id_serial: string | null
          hired_plant_description: string | null
          hired_plant_hiring_company: string | null
        }
        Insert: {
          id?: string
          van_id?: string | null
          user_id: string
          inspection_date: string
          status?: 'draft' | 'submitted' | null
          submitted_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          created_at?: string | null
          updated_at?: string | null
          manager_comments?: string | null
          inspection_end_date?: string | null
          signature_data?: string | null
          signed_at?: string | null
          current_mileage?: number | null
          inspector_comments?: string | null
          plant_id?: string | null
          is_hired_plant?: boolean
          hired_plant_id_serial?: string | null
          hired_plant_description?: string | null
          hired_plant_hiring_company?: string | null
        }
        Update: {
          id?: string
          van_id?: string | null
          user_id?: string
          inspection_date?: string
          status?: 'draft' | 'submitted' | null
          submitted_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          created_at?: string | null
          updated_at?: string | null
          manager_comments?: string | null
          inspection_end_date?: string | null
          signature_data?: string | null
          signed_at?: string | null
          current_mileage?: number | null
          inspector_comments?: string | null
          plant_id?: string | null
          is_hired_plant?: boolean
          hired_plant_id_serial?: string | null
          hired_plant_description?: string | null
          hired_plant_hiring_company?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'van_inspections_plant_id_fkey'
            columns: ['plant_id']
            isOneToOne: false
            referencedRelation: 'plant'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'van_inspections_reviewed_by_fkey'
            columns: ['reviewed_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'van_inspections_user_id_fkey'
            columns: ['user_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'van_inspections_van_id_fkey'
            columns: ['van_id']
            isOneToOne: false
            referencedRelation: 'vans'
            referencedColumns: ['id']
          },
        ]
      }
      vans: {
        Row: {
          id: string
          reg_number: string | null
          vehicle_type: string | null
          status: string | null
          created_at: string | null
          category_id: string
          nickname: string | null
          asset_type: 'vehicle' | 'plant' | 'tool' | null
          plant_id: string | null
          serial_number: string | null
          year: number | null
          weight_class: string | null
        }
        Insert: {
          id?: string
          reg_number?: string | null
          vehicle_type?: string | null
          status?: string | null
          created_at?: string | null
          category_id: string
          nickname?: string | null
          asset_type?: 'vehicle' | 'plant' | 'tool' | null
          plant_id?: string | null
          serial_number?: string | null
          year?: number | null
          weight_class?: string | null
        }
        Update: {
          id?: string
          reg_number?: string | null
          vehicle_type?: string | null
          status?: string | null
          created_at?: string | null
          category_id?: string
          nickname?: string | null
          asset_type?: 'vehicle' | 'plant' | 'tool' | null
          plant_id?: string | null
          serial_number?: string | null
          year?: number | null
          weight_class?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'vehicles_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'van_categories'
            referencedColumns: ['id']
          },
        ]
      }
      vehicle_maintenance: {
        Row: {
          id: string
          van_id: string | null
          tax_due_date: string | null
          mot_due_date: string | null
          first_aid_kit_expiry: string | null
          current_mileage: number | null
          last_service_mileage: number | null
          next_service_mileage: number | null
          cambelt_due_mileage: number | null
          last_mileage_update: string | null
          last_updated_at: string | null
          last_updated_by: string | null
          created_at: string | null
          updated_at: string | null
          notes: string | null
          tracker_id: string | null
          last_dvla_sync: string | null
          dvla_sync_status: 'never' | 'success' | 'error' | 'pending' | null
          dvla_sync_error: string | null
          dvla_raw_data: Json | null
          ves_make: string | null
          ves_colour: string | null
          ves_fuel_type: string | null
          ves_year_of_manufacture: number | null
          ves_engine_capacity: number | null
          ves_tax_status: string | null
          ves_mot_status: string | null
          ves_co2_emissions: number | null
          ves_euro_status: string | null
          ves_real_driving_emissions: string | null
          ves_type_approval: string | null
          ves_wheelplan: string | null
          ves_revenue_weight: number | null
          ves_marked_for_export: boolean | null
          ves_month_of_first_registration: string | null
          ves_date_of_last_v5c_issued: string | null
          mot_make: string | null
          mot_model: string | null
          mot_first_used_date: string | null
          mot_registration_date: string | null
          mot_manufacture_date: string | null
          mot_engine_size: string | null
          mot_fuel_type: string | null
          mot_primary_colour: string | null
          mot_secondary_colour: string | null
          mot_vehicle_id: string | null
          mot_registration: string | null
          mot_vin: string | null
          mot_v5c_reference: string | null
          mot_dvla_id: string | null
          mot_expiry_date: string | null
          mot_api_sync_status: 'never' | 'success' | 'error' | 'pending' | null
          mot_api_sync_error: string | null
          last_mot_api_sync: string | null
          mot_raw_data: Json | null
          mot_year_of_manufacture: number | null
          current_hours: number | null
          last_service_hours: number | null
          next_service_hours: number | null
          last_hours_update: string | null
          plant_id: string | null
          hgv_id: string | null
          six_weekly_inspection_due_date: string | null
          fire_extinguisher_due_date: string | null
          taco_calibration_due_date: string | null
        }
        Insert: {
          id?: string
          van_id?: string | null
          tax_due_date?: string | null
          mot_due_date?: string | null
          first_aid_kit_expiry?: string | null
          current_mileage?: number | null
          last_service_mileage?: number | null
          next_service_mileage?: number | null
          cambelt_due_mileage?: number | null
          last_mileage_update?: string | null
          last_updated_at?: string | null
          last_updated_by?: string | null
          created_at?: string | null
          updated_at?: string | null
          notes?: string | null
          tracker_id?: string | null
          last_dvla_sync?: string | null
          dvla_sync_status?: 'never' | 'success' | 'error' | 'pending' | null
          dvla_sync_error?: string | null
          dvla_raw_data?: Json | null
          ves_make?: string | null
          ves_colour?: string | null
          ves_fuel_type?: string | null
          ves_year_of_manufacture?: number | null
          ves_engine_capacity?: number | null
          ves_tax_status?: string | null
          ves_mot_status?: string | null
          ves_co2_emissions?: number | null
          ves_euro_status?: string | null
          ves_real_driving_emissions?: string | null
          ves_type_approval?: string | null
          ves_wheelplan?: string | null
          ves_revenue_weight?: number | null
          ves_marked_for_export?: boolean | null
          ves_month_of_first_registration?: string | null
          ves_date_of_last_v5c_issued?: string | null
          mot_make?: string | null
          mot_model?: string | null
          mot_first_used_date?: string | null
          mot_registration_date?: string | null
          mot_manufacture_date?: string | null
          mot_engine_size?: string | null
          mot_fuel_type?: string | null
          mot_primary_colour?: string | null
          mot_secondary_colour?: string | null
          mot_vehicle_id?: string | null
          mot_registration?: string | null
          mot_vin?: string | null
          mot_v5c_reference?: string | null
          mot_dvla_id?: string | null
          mot_expiry_date?: string | null
          mot_api_sync_status?: 'never' | 'success' | 'error' | 'pending' | null
          mot_api_sync_error?: string | null
          last_mot_api_sync?: string | null
          mot_raw_data?: Json | null
          mot_year_of_manufacture?: number | null
          current_hours?: number | null
          last_service_hours?: number | null
          next_service_hours?: number | null
          last_hours_update?: string | null
          plant_id?: string | null
          hgv_id?: string | null
          six_weekly_inspection_due_date?: string | null
          fire_extinguisher_due_date?: string | null
          taco_calibration_due_date?: string | null
        }
        Update: {
          id?: string
          van_id?: string | null
          tax_due_date?: string | null
          mot_due_date?: string | null
          first_aid_kit_expiry?: string | null
          current_mileage?: number | null
          last_service_mileage?: number | null
          next_service_mileage?: number | null
          cambelt_due_mileage?: number | null
          last_mileage_update?: string | null
          last_updated_at?: string | null
          last_updated_by?: string | null
          created_at?: string | null
          updated_at?: string | null
          notes?: string | null
          tracker_id?: string | null
          last_dvla_sync?: string | null
          dvla_sync_status?: 'never' | 'success' | 'error' | 'pending' | null
          dvla_sync_error?: string | null
          dvla_raw_data?: Json | null
          ves_make?: string | null
          ves_colour?: string | null
          ves_fuel_type?: string | null
          ves_year_of_manufacture?: number | null
          ves_engine_capacity?: number | null
          ves_tax_status?: string | null
          ves_mot_status?: string | null
          ves_co2_emissions?: number | null
          ves_euro_status?: string | null
          ves_real_driving_emissions?: string | null
          ves_type_approval?: string | null
          ves_wheelplan?: string | null
          ves_revenue_weight?: number | null
          ves_marked_for_export?: boolean | null
          ves_month_of_first_registration?: string | null
          ves_date_of_last_v5c_issued?: string | null
          mot_make?: string | null
          mot_model?: string | null
          mot_first_used_date?: string | null
          mot_registration_date?: string | null
          mot_manufacture_date?: string | null
          mot_engine_size?: string | null
          mot_fuel_type?: string | null
          mot_primary_colour?: string | null
          mot_secondary_colour?: string | null
          mot_vehicle_id?: string | null
          mot_registration?: string | null
          mot_vin?: string | null
          mot_v5c_reference?: string | null
          mot_dvla_id?: string | null
          mot_expiry_date?: string | null
          mot_api_sync_status?: 'never' | 'success' | 'error' | 'pending' | null
          mot_api_sync_error?: string | null
          last_mot_api_sync?: string | null
          mot_raw_data?: Json | null
          mot_year_of_manufacture?: number | null
          current_hours?: number | null
          last_service_hours?: number | null
          next_service_hours?: number | null
          last_hours_update?: string | null
          plant_id?: string | null
          hgv_id?: string | null
          six_weekly_inspection_due_date?: string | null
          fire_extinguisher_due_date?: string | null
          taco_calibration_due_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'van_maintenance_hgv_id_fkey'
            columns: ['hgv_id']
            isOneToOne: false
            referencedRelation: 'hgvs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'van_maintenance_last_updated_by_fkey'
            columns: ['last_updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'van_maintenance_plant_id_fkey'
            columns: ['plant_id']
            isOneToOne: false
            referencedRelation: 'plant'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'van_maintenance_van_id_fkey'
            columns: ['van_id']
            isOneToOne: false
            referencedRelation: 'vans'
            referencedColumns: ['id']
          },
        ]
      }
      webauthn_audit_events: {
        Row: {
          id: string
          profile_id: string
          actor_profile_id: string | null
          event_type: 'biometric_registration_success' | 'biometric_registration_failed' | 'biometric_login_success' | 'biometric_login_failed' | 'biometric_prompt_dismissed' | 'biometric_credential_revoked'
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          actor_profile_id?: string | null
          event_type: 'biometric_registration_success' | 'biometric_registration_failed' | 'biometric_login_success' | 'biometric_login_failed' | 'biometric_prompt_dismissed' | 'biometric_credential_revoked'
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          actor_profile_id?: string | null
          event_type?: 'biometric_registration_success' | 'biometric_registration_failed' | 'biometric_login_success' | 'biometric_login_failed' | 'biometric_prompt_dismissed' | 'biometric_credential_revoked'
          metadata?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'account_switch_audit_events_actor_profile_id_fkey'
            columns: ['actor_profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'account_switch_audit_events_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      webauthn_challenges: {
        Row: {
          id: string
          profile_id: string | null
          device_id: string | null
          challenge: string
          challenge_type: 'registration' | 'authentication'
          webauthn_user_id: string | null
          expires_at: string
          consumed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          profile_id?: string | null
          device_id?: string | null
          challenge: string
          challenge_type: 'registration' | 'authentication'
          webauthn_user_id?: string | null
          expires_at: string
          consumed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          profile_id?: string | null
          device_id?: string | null
          challenge?: string
          challenge_type?: 'registration' | 'authentication'
          webauthn_user_id?: string | null
          expires_at?: string
          consumed_at?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'webauthn_challenges_device_id_fkey'
            columns: ['device_id']
            isOneToOne: false
            referencedRelation: 'webauthn_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'webauthn_challenges_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      webauthn_credentials: {
        Row: {
          id: string
          profile_id: string
          device_id: string | null
          credential_id: string
          public_key: string
          webauthn_user_id: string
          counter: number
          transports: string[] | null
          device_type: 'singleDevice' | 'multiDevice'
          backed_up: boolean
          authenticator_attachment: string
          name: string | null
          last_used_at: string | null
          revoked_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          profile_id: string
          device_id?: string | null
          credential_id: string
          public_key: string
          webauthn_user_id: string
          counter?: number
          transports?: string[] | null
          device_type: 'singleDevice' | 'multiDevice'
          backed_up?: boolean
          authenticator_attachment?: string
          name?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          profile_id?: string
          device_id?: string | null
          credential_id?: string
          public_key?: string
          webauthn_user_id?: string
          counter?: number
          transports?: string[] | null
          device_type?: 'singleDevice' | 'multiDevice'
          backed_up?: boolean
          authenticator_attachment?: string
          name?: string | null
          last_used_at?: string | null
          revoked_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'webauthn_credentials_device_id_fkey'
            columns: ['device_id']
            isOneToOne: false
            referencedRelation: 'webauthn_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'webauthn_credentials_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      webauthn_devices: {
        Row: {
          id: string
          profile_id: string
          device_id_hash: string
          device_label: string | null
          trusted_at: string
          last_seen_at: string
          revoked_at: string | null
          created_at: string
          updated_at: string
          last_authenticated_at: string | null
        }
        Insert: {
          id?: string
          profile_id: string
          device_id_hash: string
          device_label?: string | null
          trusted_at?: string
          last_seen_at?: string
          revoked_at?: string | null
          created_at?: string
          updated_at?: string
          last_authenticated_at?: string | null
        }
        Update: {
          id?: string
          profile_id?: string
          device_id_hash?: string
          device_label?: string | null
          trusted_at?: string
          last_seen_at?: string
          revoked_at?: string | null
          created_at?: string
          updated_at?: string
          last_authenticated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'account_switch_devices_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      webauthn_prompt_preferences: {
        Row: {
          profile_id: string
          device_id: string
          dismissed_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          profile_id: string
          device_id: string
          dismissed_at?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          profile_id?: string
          device_id?: string
          dismissed_at?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'webauthn_prompt_preferences_device_id_fkey'
            columns: ['device_id']
            isOneToOne: false
            referencedRelation: 'webauthn_devices'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'webauthn_prompt_preferences_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      work_calendar_entries: {
        Row: {
          id: string
          quote_id: string | null
          title: string
          summary: string | null
          start_date: string
          estimated_duration_days: number
          created_by: string | null
          updated_by: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          quote_id?: string | null
          title: string
          summary?: string | null
          start_date: string
          estimated_duration_days?: number
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          quote_id?: string | null
          title?: string
          summary?: string | null
          start_date?: string
          estimated_duration_days?: number
          created_by?: string | null
          updated_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'work_calendar_entries_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'work_calendar_entries_quote_id_fkey'
            columns: ['quote_id']
            isOneToOne: false
            referencedRelation: 'quotes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'work_calendar_entries_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      work_shift_template_slots: {
        Row: {
          template_id: string
          day_of_week: number
          am_working: boolean
          pm_working: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          template_id: string
          day_of_week: number
          am_working?: boolean
          pm_working?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          template_id?: string
          day_of_week?: number
          am_working?: boolean
          pm_working?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'work_shift_template_slots_template_id_fkey'
            columns: ['template_id']
            isOneToOne: false
            referencedRelation: 'work_shift_templates'
            referencedColumns: ['id']
          },
        ]
      }
      work_shift_templates: {
        Row: {
          id: string
          name: string
          description: string | null
          is_default: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          is_default?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          is_default?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: [
        ]
      }
      workshop_attachment_field_responses: {
        Row: {
          id: string
          attachment_id: string
          field_id: string | null
          section_key: string
          field_key: string
          response_value: string | null
          response_json: Json | null
          created_at: string
          updated_at: string | null
        }
        Insert: {
          id?: string
          attachment_id: string
          field_id?: string | null
          section_key: string
          field_key: string
          response_value?: string | null
          response_json?: Json | null
          created_at?: string
          updated_at?: string | null
        }
        Update: {
          id?: string
          attachment_id?: string
          field_id?: string | null
          section_key?: string
          field_key?: string
          response_value?: string | null
          response_json?: Json | null
          created_at?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'workshop_attachment_field_responses_attachment_id_fkey'
            columns: ['attachment_id']
            isOneToOne: false
            referencedRelation: 'workshop_task_attachments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workshop_attachment_field_responses_field_id_fkey'
            columns: ['field_id']
            isOneToOne: false
            referencedRelation: 'workshop_attachment_template_fields'
            referencedColumns: ['id']
          },
        ]
      }
      workshop_attachment_schema_snapshots: {
        Row: {
          id: string
          attachment_id: string
          template_version_id: string | null
          snapshot_json: Json
          created_at: string
          created_by: string | null
        }
        Insert: {
          id?: string
          attachment_id: string
          template_version_id?: string | null
          snapshot_json: Json
          created_at?: string
          created_by?: string | null
        }
        Update: {
          id?: string
          attachment_id?: string
          template_version_id?: string | null
          snapshot_json?: Json
          created_at?: string
          created_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'workshop_attachment_schema_snapshots_attachment_id_fkey'
            columns: ['attachment_id']
            isOneToOne: false
            referencedRelation: 'workshop_task_attachments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workshop_attachment_schema_snapshots_template_version_id_fkey'
            columns: ['template_version_id']
            isOneToOne: false
            referencedRelation: 'workshop_attachment_template_versions'
            referencedColumns: ['id']
          },
        ]
      }
      workshop_attachment_template_fields: {
        Row: {
          id: string
          section_id: string
          field_key: string
          label: string
          help_text: string | null
          field_type: 'marking_code' | 'text' | 'long_text' | 'number' | 'date' | 'yes_no' | 'signature'
          is_required: boolean
          sort_order: number
          options_json: Json | null
          validation_json: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          section_id: string
          field_key: string
          label: string
          help_text?: string | null
          field_type: 'marking_code' | 'text' | 'long_text' | 'number' | 'date' | 'yes_no' | 'signature'
          is_required?: boolean
          sort_order?: number
          options_json?: Json | null
          validation_json?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          section_id?: string
          field_key?: string
          label?: string
          help_text?: string | null
          field_type?: 'marking_code' | 'text' | 'long_text' | 'number' | 'date' | 'yes_no' | 'signature'
          is_required?: boolean
          sort_order?: number
          options_json?: Json | null
          validation_json?: Json | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'workshop_attachment_template_fields_section_id_fkey'
            columns: ['section_id']
            isOneToOne: false
            referencedRelation: 'workshop_attachment_template_sections'
            referencedColumns: ['id']
          },
        ]
      }
      workshop_attachment_template_sections: {
        Row: {
          id: string
          version_id: string
          section_key: string
          title: string
          description: string | null
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          version_id: string
          section_key: string
          title: string
          description?: string | null
          sort_order?: number
          created_at?: string
        }
        Update: {
          id?: string
          version_id?: string
          section_key?: string
          title?: string
          description?: string | null
          sort_order?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'workshop_attachment_template_sections_version_id_fkey'
            columns: ['version_id']
            isOneToOne: false
            referencedRelation: 'workshop_attachment_template_versions'
            referencedColumns: ['id']
          },
        ]
      }
      workshop_attachment_template_versions: {
        Row: {
          id: string
          template_id: string
          version_number: number
          status: 'draft' | 'published' | 'archived'
          created_at: string
          created_by: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          template_id: string
          version_number: number
          status?: 'draft' | 'published' | 'archived'
          created_at?: string
          created_by?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          template_id?: string
          version_number?: number
          status?: 'draft' | 'published' | 'archived'
          created_at?: string
          created_by?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'workshop_attachment_template_versions_template_id_fkey'
            columns: ['template_id']
            isOneToOne: false
            referencedRelation: 'workshop_attachment_templates'
            referencedColumns: ['id']
          },
        ]
      }
      workshop_attachment_templates: {
        Row: {
          id: string
          name: string
          description: string | null
          is_active: boolean | null
          created_at: string
          created_by: string | null
          updated_at: string | null
          applies_to: string[]
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          is_active?: boolean | null
          created_at?: string
          created_by?: string | null
          updated_at?: string | null
          applies_to?: string[]
        }
        Update: {
          id?: string
          name?: string
          description?: string | null
          is_active?: boolean | null
          created_at?: string
          created_by?: string | null
          updated_at?: string | null
          applies_to?: string[]
        }
        Relationships: [
        ]
      }
      workshop_task_attachments: {
        Row: {
          id: string
          task_id: string
          template_id: string
          status: 'pending' | 'completed'
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
        }
        Insert: {
          id?: string
          task_id: string
          template_id: string
          status?: 'pending' | 'completed'
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
        }
        Update: {
          id?: string
          task_id?: string
          template_id?: string
          status?: 'pending' | 'completed'
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'workshop_task_attachments_completed_by_fkey'
            columns: ['completed_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workshop_task_attachments_task_id_fkey'
            columns: ['task_id']
            isOneToOne: false
            referencedRelation: 'actions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workshop_task_attachments_template_id_fkey'
            columns: ['template_id']
            isOneToOne: false
            referencedRelation: 'workshop_attachment_templates'
            referencedColumns: ['id']
          },
        ]
      }
      workshop_task_categories: {
        Row: {
          id: string
          applies_to: 'van' | 'hgv' | 'plant' | 'tools'
          name: string
          is_active: boolean | null
          sort_order: number | null
          created_at: string | null
          created_by: string | null
          updated_at: string | null
          slug: string | null
          ui_color: string | null
          ui_icon: string | null
          ui_badge_style: string | null
          completion_updates: Json | null
          requires_subcategories: boolean
        }
        Insert: {
          id?: string
          applies_to?: 'van' | 'hgv' | 'plant' | 'tools'
          name: string
          is_active?: boolean | null
          sort_order?: number | null
          created_at?: string | null
          created_by?: string | null
          updated_at?: string | null
          slug?: string | null
          ui_color?: string | null
          ui_icon?: string | null
          ui_badge_style?: string | null
          completion_updates?: Json | null
          requires_subcategories?: boolean
        }
        Update: {
          id?: string
          applies_to?: 'van' | 'hgv' | 'plant' | 'tools'
          name?: string
          is_active?: boolean | null
          sort_order?: number | null
          created_at?: string | null
          created_by?: string | null
          updated_at?: string | null
          slug?: string | null
          ui_color?: string | null
          ui_icon?: string | null
          ui_badge_style?: string | null
          completion_updates?: Json | null
          requires_subcategories?: boolean
        }
        Relationships: [
        ]
      }
      workshop_task_comments: {
        Row: {
          id: string
          task_id: string
          author_id: string
          body: string
          created_at: string
          updated_at: string | null
        }
        Insert: {
          id?: string
          task_id: string
          author_id: string
          body: string
          created_at?: string
          updated_at?: string | null
        }
        Update: {
          id?: string
          task_id?: string
          author_id?: string
          body?: string
          created_at?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'workshop_task_comments_author_id_fkey'
            columns: ['author_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workshop_task_comments_task_id_fkey'
            columns: ['task_id']
            isOneToOne: false
            referencedRelation: 'actions'
            referencedColumns: ['id']
          },
        ]
      }
      workshop_task_subcategories: {
        Row: {
          id: string
          category_id: string
          name: string
          slug: string
          sort_order: number | null
          is_active: boolean | null
          ui_color: string | null
          ui_icon: string | null
          ui_badge_style: string | null
          created_at: string
          created_by: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          category_id: string
          name: string
          slug: string
          sort_order?: number | null
          is_active?: boolean | null
          ui_color?: string | null
          ui_icon?: string | null
          ui_badge_style?: string | null
          created_at?: string
          created_by?: string | null
          updated_at?: string | null
        }
        Update: {
          id?: string
          category_id?: string
          name?: string
          slug?: string
          sort_order?: number | null
          is_active?: boolean | null
          ui_color?: string | null
          ui_icon?: string | null
          ui_badge_style?: string | null
          created_at?: string
          created_by?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'workshop_task_subcategories_category_id_fkey'
            columns: ['category_id']
            isOneToOne: false
            referencedRelation: 'workshop_task_categories'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_project_schedule_job: {
        Args: {
          p_project_number_id: string | null
          p_manager_profile_id: string | null
          p_project_title: string | null
          p_project_description: string | null
          p_project_notes: string | null
          p_customer_id: string
          p_customer_site_id: string | null
          p_site_address: string | null
          p_job_status: string
          p_start_date: string
          p_end_date: string
          p_estimated_duration_minutes: number | null
          p_is_drop_on_ready: boolean
          p_tag_ids: string[]
          p_actor_user_id: string
        }
        Returns: {
          project_number_id: string
          schedule_job_id: string
          project_reference: string
          was_project_created: boolean
        }[]
      }
      inventory_move_items_with_batch: {
        Args: {
          p_item_ids: string[]
          p_destination_location_id: string
          p_note: string | null
          p_moved_by: string
          p_move_scope: string
          p_group_id: string | null
        }
        Returns: {
          item_id: string
          from_location_id: string | null
          to_location_id: string
          movement_batch_id: string
        }[]
      }
      inventory_clear_user_location_with_assignment: {
        Args: {
          p_user_id: string
          p_actor_user_id: string
        }
        Returns: undefined
      }
      inventory_set_user_location_with_assignment: {
        Args: {
          p_user_id: string
          p_location_id: string
          p_change_reason: string | null
          p_actor_user_id: string
        }
        Returns: {
          user_id: string
          location_id: string
        }[]
      }
      remove_schedule_job: {
        Args: {
          p_job_id: string
          p_actor_user_id: string
        }
        Returns: {
          removed_source_type: string
          removed_quote_id: string | null
          removed_project_number_id: string | null
        }[]
      }
    }
    Enums: {
      check__absences__half_day_session: 'AM' | 'PM'
      check__absences__status: 'pending' | 'approved' | 'processed' | 'rejected' | 'cancelled'
      check__absences_archive__half_day_session: 'AM' | 'PM'
      check__absences_archive__status: 'pending' | 'approved' | 'processed' | 'rejected' | 'cancelled'
      check__actions__action_type: 'inspection_defect' | 'workshop_vehicle_task' | 'manager_action'
      check__actions__priority: 'low' | 'medium' | 'high' | 'urgent'
      check__actions__status: 'pending' | 'in_progress' | 'logged' | 'on_hold' | 'completed'
      check__app_auth_sessions__session_source: 'password_login' | 'session_bootstrap' | 'biometric_login'
      check__customers__status: 'active' | 'inactive'
      check__display_board_pairing_sessions__status: 'active' | 'confirmed' | 'cancelled' | 'expired'
      check__dvla_sync_log__sync_status: 'success' | 'error'
      check__dvla_sync_log__trigger_type: 'manual' | 'bulk' | 'automatic' | 'auto_on_create'
      check__error_reports__status: 'new' | 'investigating' | 'resolved'
      check__hgv_inspections__status: 'draft' | 'submitted'
      check__inspection_items__status: 'ok' | 'attention' | 'defect' | 'na'
      check__inspection_orphan_children_archive__child_table: 'inspection_items' | 'inspection_photos'
      check__inventory_item_groups__status: 'active' | 'inactive'
      check__inventory_item_movement_batches__move_scope: 'single' | 'bulk' | 'group' | 'claim'
      check__inventory_items__status: 'active' | 'retired'
      check__inventory_location_requests__status: 'pending' | 'approved' | 'rejected' | 'duplicate'
      check__maintenance_categories__responsibility: 'workshop' | 'office'
      check__maintenance_categories__type: 'date' | 'mileage' | 'hours'
      check__maintenance_history__value_type: 'date' | 'mileage' | 'boolean' | 'text'
      check__message_recipients__status: 'PENDING' | 'SHOWN' | 'SIGNED' | 'DISMISSED'
      check__messages__module_key: 'errors' | 'maintenance' | 'rams' | 'approvals' | 'inspections' | 'absence' | 'timesheets' | 'inventory' | 'processed_absence' | 'training' | 'suggestions' | 'toolbox_talks' | 'reminders' | 'quotes' | 'general_notifications' | 'sensitive_pin_security'
      check__messages__priority: 'LOW' | 'HIGH' | 'URGENT'
      check__messages__type: 'TOOLBOX_TALK' | 'REMINDER' | 'NOTIFICATION'
      check__notification_preferences__module_key: 'errors' | 'maintenance' | 'rams' | 'approvals' | 'inspections' | 'absence' | 'timesheets' | 'inventory' | 'processed_absence' | 'training' | 'suggestions' | 'toolbox_talks' | 'reminders' | 'quotes' | 'general_notifications' | 'sensitive_pin_security'
      check__org_teams__timesheet_type: 'civils' | 'plant'
      check__plant__status: 'active' | 'inactive' | 'maintenance' | 'retired'
      check__plant_inspections__status: 'draft' | 'submitted'
      check__profile_reporting_lines__relation_type: 'primary' | 'secondary' | 'line_manager'
      check__quote_attachments__attachment_purpose: 'internal' | 'client_pricing' | 'client_supporting'
      check__quote_invoice_notification_recipients__notification_type: 'invoice_request' | 'invoice_added' | 'quote_sent_copy' | 'start_alert_copy'
      check__quote_invoice_requests__requested_invoice_scope: 'full' | 'partial'
      check__quote_invoice_requests__status: 'pending' | 'fulfilled' | 'cancelled'
      check__quote_invoices__invoice_scope: 'full' | 'partial'
      check__quote_project_costs__category: 'materials' | 'subcontractor' | 'plant' | 'labour' | 'other'
      check__quote_project_numbers__status: 'open' | 'linked' | 'converted' | 'cancelled'
      check__quotes__commercial_status: 'open' | 'closed'
      check__quotes__completion_status: 'not_completed' | 'approved_in_full' | 'approved_in_part'
      check__quotes__pricing_mode: 'itemized' | 'attachments_only'
      check__quotes__revision_type: 'original' | 'revision' | 'extra' | 'variation' | 'future_work' | 'duplicate'
      check__quotes__status: 'draft' | 'pending_internal_approval' | 'changes_requested' | 'approved' | 'sent' | 'won' | 'lost' | 'ready_to_invoice' | 'po_received' | 'in_progress' | 'completed_part' | 'completed_full' | 'partially_invoiced' | 'invoiced' | 'closed'
      check__reminder_actions__priority: 'low' | 'medium' | 'high' | 'urgent'
      check__reminder_actions__source_type: 'system_generated' | 'manager_created'
      check__reminder_actions__status: 'open' | 'resolved' | 'cancelled'
      check__reminders__status: 'pending' | 'actioned' | 'cancelled'
      check__roles__role_class: 'admin' | 'manager' | 'employee'
      check__roles__timesheet_type: 'civils' | 'plant'
      check__sensitive_pin_audit_events__event_type: 'setup_requested' | 'setup_confirmed' | 'change_requested' | 'change_confirmed' | 'reset_requested' | 'reset_confirmed' | 'admin_reset' | 'unlock_success' | 'unlock_failed' | 'pin_locked'
      check__sensitive_pin_verification_tokens__pending_pin_length: 4 | 6
      check__sensitive_pin_verification_tokens__purpose: 'setup' | 'change' | 'reset'
      check__service_health_events__status: 'active' | 'recovered'
      check__suggestions__status: 'new' | 'under_review' | 'planned' | 'completed' | 'declined'
      check__timesheets__status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'processed' | 'adjusted'
      check__timesheets__template_version: 1 | 2
      check__timesheets__timesheet_type: 'civils' | 'plant'
      check__training_people__profile_match_status: 'matched' | 'ambiguous' | 'unmatched' | 'not_attempted'
      check__training_qualifications__validation_status: 'needs_manual_review' | 'plant_category_or_card_scheme' | 'standardised_or_spelling_corrected' | 'note_or_status_mixed_with_qualification'
      check__training_records__qualification_validation_status: 'needs_manual_review' | 'plant_category_or_card_scheme' | 'standardised_or_spelling_corrected' | 'note_or_status_mixed_with_qualification'
      check__training_records__record_status: 'active' | 'archived'
      check__training_workbook_notes__note_type: 'workbook_note' | 'likely_misc_note'
      check__user_usage_events__event_category: 'session' | 'navigation' | 'auth' | 'error' | 'performance'
      check__user_usage_events__event_name: 'session_started' | 'session_heartbeat' | 'session_ended' | 'page_view' | 'route_changed' | 'visibility_resume' | 'auth_login_success' | 'auth_login_failed' | 'auth_logout' | 'error_observed'
      check__user_usage_events__event_source: 'client' | 'server'
      check__user_usage_retention_runs__status: 'running' | 'completed' | 'failed'
      check__user_usage_sessions__device_type: 'desktop' | 'mobile' | 'tablet' | 'unknown'
      check__van_archive__archive_reason: 'Sold' | 'Scrapped' | 'Other'
      check__van_inspections__status: 'draft' | 'submitted'
      check__vans__asset_type: 'vehicle' | 'plant' | 'tool'
      check__vehicle_maintenance__dvla_sync_status: 'never' | 'success' | 'error' | 'pending'
      check__vehicle_maintenance__mot_api_sync_status: 'never' | 'success' | 'error' | 'pending'
      check__webauthn_audit_events__event_type: 'biometric_registration_success' | 'biometric_registration_failed' | 'biometric_login_success' | 'biometric_login_failed' | 'biometric_prompt_dismissed' | 'biometric_credential_revoked'
      check__webauthn_challenges__challenge_type: 'registration' | 'authentication'
      check__webauthn_credentials__device_type: 'singleDevice' | 'multiDevice'
      check__workshop_task_categories__applies_to: 'van' | 'hgv' | 'plant' | 'tools'
      workshop_attachment_field_type: 'marking_code' | 'text' | 'long_text' | 'number' | 'date' | 'yes_no' | 'signature'
      workshop_attachment_status: 'pending' | 'completed'
      workshop_attachment_template_version_status: 'draft' | 'published' | 'archived'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
