import Foundation
import CoreData

@objc(CachedListing)
final class CachedListing: NSManagedObject {
    @NSManaged var id: String
    @NSManaged var title: String
    @NSManaged var subtitle: String?
    @NSManaged var priceText: String?
    @NSManaged var priceValue: NSNumber?
    @NSManaged var locationLabel: String?
    @NSManaged var descriptionText: String?
    @NSManaged var tagsString: String?
    @NSManaged var coverURL: String?
    @NSManaged var sellerName: String?
    @NSManaged var sellerAvatar: String?
    @NSManaged var createdAt: Date?
    @NSManaged var isFavorite: Bool
    @NSManaged var isBoosted: Bool
    @NSManaged var isSold: Bool
    @NSManaged var distanceText: String?
    @NSManaged var distanceValue: NSNumber?
    @NSManaged var updatedAt: Date
}

extension CachedListing {
    @nonobjc class func fetchRequest() -> NSFetchRequest<CachedListing> {
        NSFetchRequest<CachedListing>(entityName: "CachedListing")
    }
}
