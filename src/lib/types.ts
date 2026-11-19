import type { Gender } from "@/lib/validation";

export type Traveller = {
  id: string;
  full_name_as_on_id: string;
  date_of_birth: string;
  gender: Gender;
  is_self: boolean;
};
