import { Phone, Users, MapPin } from 'lucide-react';
import type { ScheduleSelfCrewMember, ScheduleSelfJobDetails } from '@/types/scheduling';

export function SchedulingJobSiteDetails({ details, crew }: {
  details?: ScheduleSelfJobDetails;
  crew: ScheduleSelfCrewMember[];
}) {
  const contact = details?.customer_contact;
  return (
    <div className="space-y-4 text-[max(1rem,16px)]">
      {crew.length > 0 ? (
        <div className="mt-4">
          <p className="flex items-center gap-2 font-medium text-foreground"><Users aria-hidden="true" className="h-4 w-4 text-scheduling" />Working with</p>
          <p className="mt-1 break-words text-muted-foreground">{crew.map((person) => person.full_name).join(', ')}</p>
        </div>
      ) : null}
      {details?.site_name || details?.site_notes ? (
        <div className="mt-4">
          {details.site_name ? <p className="flex items-start gap-2 break-words font-medium text-foreground"><MapPin aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-scheduling" />{details.site_name}</p> : null}
          {details.site_notes ? <p className="mt-1 whitespace-pre-wrap break-words text-foreground"><span className="font-medium">Site notes: </span>{details.site_notes}</p> : null}
        </div>
      ) : null}
      {contact ? (
        <div className="mt-4 border-t border-border pt-4">
          <p className="font-medium text-foreground">Customer contact</p>
          {contact.name ? <p className="mt-1 break-words text-foreground">{contact.name}{contact.job_title ? ` · ${contact.job_title}` : ''}</p> : null}
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {contact.phone ? <a className="inline-flex min-h-[44px] items-center gap-2 break-all font-medium text-scheduling underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" href={`tel:${contact.phone.replace(/[^+\d]/g, '')}`}><Phone aria-hidden="true" className="h-4 w-4 shrink-0" />{contact.phone}</a> : null}
            {contact.email ? <a className="inline-flex min-h-[44px] items-center break-all text-scheduling underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" href={`mailto:${contact.email}`}>{contact.email}</a> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
