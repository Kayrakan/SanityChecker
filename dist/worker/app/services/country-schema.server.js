const COUNTRIES = [
    { code: "US", name: "United States", requiresPostal: true, requiresProvince: true, requiresCity: true, provinceLabel: "State", cityLabel: "City", subdivisions: [
            { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" }, { code: "AZ", name: "Arizona" }, { code: "AR", name: "Arkansas" },
            { code: "CA", name: "California" }, { code: "CO", name: "Colorado" }, { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" },
            { code: "FL", name: "Florida" }, { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" }, { code: "ID", name: "Idaho" },
            { code: "IL", name: "Illinois" }, { code: "IN", name: "Indiana" }, { code: "IA", name: "Iowa" }, { code: "KS", name: "Kansas" },
            { code: "KY", name: "Kentucky" }, { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" }, { code: "MD", name: "Maryland" },
            { code: "MA", name: "Massachusetts" }, { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" }, { code: "MS", name: "Mississippi" },
            { code: "MO", name: "Missouri" }, { code: "MT", name: "Montana" }, { code: "NE", name: "Nebraska" }, { code: "NV", name: "Nevada" },
            { code: "NH", name: "New Hampshire" }, { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" }, { code: "NY", name: "New York" },
            { code: "NC", name: "North Carolina" }, { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" }, { code: "OK", name: "Oklahoma" },
            { code: "OR", name: "Oregon" }, { code: "PA", name: "Pennsylvania" }, { code: "RI", name: "Rhode Island" }, { code: "SC", name: "South Carolina" },
            { code: "SD", name: "South Dakota" }, { code: "TN", name: "Tennessee" }, { code: "TX", name: "Texas" }, { code: "UT", name: "Utah" },
            { code: "VT", name: "Vermont" }, { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" }, { code: "WV", name: "West Virginia" },
            { code: "WI", name: "Wisconsin" }, { code: "WY", name: "Wyoming" }
        ] },
    { code: "CA", name: "Canada", requiresPostal: true, requiresProvince: true, requiresCity: true, provinceLabel: "Province", cityLabel: "City", subdivisions: [
            { code: "AB", name: "Alberta" }, { code: "BC", name: "British Columbia" }, { code: "MB", name: "Manitoba" }, { code: "NB", name: "New Brunswick" },
            { code: "NL", name: "Newfoundland and Labrador" }, { code: "NS", name: "Nova Scotia" }, { code: "NT", name: "Northwest Territories" }, { code: "NU", name: "Nunavut" },
            { code: "ON", name: "Ontario" }, { code: "PE", name: "Prince Edward Island" }, { code: "QC", name: "Quebec" }, { code: "SK", name: "Saskatchewan" },
            { code: "YT", name: "Yukon" }
        ] },
    { code: "DE", name: "Germany", requiresPostal: true, requiresProvince: false, requiresCity: true, cityLabel: "City" },
    { code: "FR", name: "France", requiresPostal: true, requiresProvince: false, requiresCity: true, cityLabel: "City" },
    { code: "NL", name: "Netherlands", requiresPostal: true, requiresProvince: false, requiresCity: true, cityLabel: "City" },
    { code: "AU", name: "Australia", requiresPostal: true, requiresProvince: true, requiresCity: true, provinceLabel: "State", cityLabel: "City", subdivisions: [
            { code: "NSW", name: "New South Wales" }, { code: "QLD", name: "Queensland" }, { code: "SA", name: "South Australia" }, { code: "TAS", name: "Tasmania" },
            { code: "VIC", name: "Victoria" }, { code: "WA", name: "Western Australia" }, { code: "ACT", name: "Australian Capital Territory" }, { code: "NT", name: "Northern Territory" }
        ] },
    { code: "BR", name: "Brazil", requiresPostal: true, requiresProvince: true, requiresCity: true, provinceLabel: "State", cityLabel: "City", subdivisions: [
            { code: "SP", name: "São Paulo" }, { code: "RJ", name: "Rio de Janeiro" }, { code: "MG", name: "Minas Gerais" }, { code: "BA", name: "Bahia" }
        ] },
    { code: "TR", name: "Türkiye", requiresPostal: true, requiresProvince: false, requiresCity: true, cityLabel: "Il (City)" },
    { code: "HK", name: "Hong Kong", requiresPostal: false, requiresProvince: false, requiresCity: true, cityLabel: "District" },
    { code: "AE", name: "United Arab Emirates", requiresPostal: false, requiresProvince: true, requiresCity: true, provinceLabel: "Emirate", cityLabel: "City", subdivisions: [
            { code: "AJ", name: "Ajman" }, { code: "AZ", name: "Abu Dhabi" }, { code: "DU", name: "Dubai" }, { code: "FU", name: "Fujairah" }, { code: "RK", name: "Ras Al Khaimah" }, { code: "SH", name: "Sharjah" }, { code: "UQ", name: "Umm Al Quwain" }
        ] },
    { code: "SG", name: "Singapore", requiresPostal: true, requiresProvince: false, requiresCity: true, cityLabel: "Area" },
    { code: "GB", name: "United Kingdom", requiresPostal: true, requiresProvince: false, requiresCity: true, cityLabel: "Town/City" },
];
export function listCountries() {
    return COUNTRIES.map(c => ({ label: c.name, value: c.code }));
}
export function getCountrySchema(code) {
    return COUNTRIES.find(c => c.code === code.toUpperCase());
}
export function getSubdivisions(code) {
    return getCountrySchema(code)?.subdivisions ?? [];
}
export function listCountrySchemas() {
    return COUNTRIES;
}
